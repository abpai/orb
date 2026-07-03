import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import { TTSError } from '../types'

export const DEFAULT_SERVER_URL = 'http://localhost:8000'
const DEFAULT_SPEECH_PATH = '/v1/speech'
const DEFAULT_STREAM_PATH = '/tts/stream'
const DEFAULT_STREAM_PCM_PATH = '/tts/stream/pcm'
const DEFAULT_WARMUP_PATH = '/warmup'
const GATEWAY_VOICE_BY_ORB_VOICE: Record<string, string> = {
  alba: 'af_heart',
  marius: 'am_michael',
  jean: 'am_puck',
}

interface GatewaySpeechResult {
  audio: Buffer
  contentType: string
}

export interface GatewayRawPcmFormat {
  kind: 'raw-pcm'
  contentType: string
  sampleRate: number
  channels: number
  sampleWidth: number
  pcmFormat: string
}

export type GatewayStreamFormat = { kind: 'encoded'; contentType: string } | GatewayRawPcmFormat

export interface GatewayStreamResult {
  stream: ReadableStream<Uint8Array>
  format: GatewayStreamFormat
  speedApplied: number | null
}

function parseUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim() || DEFAULT_SERVER_URL

  try {
    return new URL(trimmed)
  } catch {
    throw new TTSError('Invalid TTS server URL', 'generation_failed')
  }
}

function resolveUrl(rawUrl: string, defaultPath: string): string {
  const url = parseUrl(rawUrl)

  if (!url.pathname || url.pathname === '/') {
    url.pathname = defaultPath
  }

  return url.toString()
}

function resolvePcmStreamUrl(rawUrl: string): string | null {
  const url = parseUrl(rawUrl)
  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/'

  if (normalizedPath === '/') {
    url.pathname = DEFAULT_STREAM_PCM_PATH
    return url.toString()
  }

  if (normalizedPath === DEFAULT_STREAM_PATH) {
    url.pathname = DEFAULT_STREAM_PCM_PATH
    return url.toString()
  }

  return null
}

function resolveWarmupUrl(rawUrl: string): string | null {
  const url = parseUrl(rawUrl)
  const normalizedPath = url.pathname.replace(/\/+$/, '') || '/'

  if (
    normalizedPath === '/' ||
    normalizedPath === DEFAULT_SPEECH_PATH ||
    normalizedPath === DEFAULT_STREAM_PATH ||
    normalizedPath === DEFAULT_STREAM_PCM_PATH
  ) {
    url.pathname = DEFAULT_WARMUP_PATH
    return url.toString()
  }

  return null
}

interface SpeechPayload {
  text: string
  voice?: string
  speed?: number
}

function buildJsonPayload(text: string, voice?: string, speed?: number): SpeechPayload {
  const gatewayVoice = resolveGatewayVoice(voice)
  const payload: SpeechPayload = { text }
  if (gatewayVoice) {
    payload.voice = gatewayVoice
  }
  if (typeof speed === 'number' && Number.isFinite(speed) && speed !== 1) {
    payload.speed = speed
  }
  return payload
}

function buildFormData(text: string, voice?: string): globalThis.FormData {
  const gatewayVoice = resolveGatewayVoice(voice)
  const formData = new globalThis.FormData()
  formData.append('text', text)
  if (gatewayVoice) {
    formData.append('voice', gatewayVoice)
  }
  return formData
}

function resolveGatewayVoice(voice: string | undefined): string | undefined {
  if (!voice) return undefined
  return GATEWAY_VOICE_BY_ORB_VOICE[voice] ?? voice
}

function mapStatusToMessage(status: number, detail?: string | null): string {
  switch (status) {
    case 422:
      return 'Gateway rejected request: empty or invalid text'
    case 502:
      return 'Gateway engine failure'
    case 503:
      return 'Gateway unavailable (no TTS engines running)'
    case 504:
      if (detail?.toLowerCase().includes('first audio')) {
        return 'Gateway stream timed out before first audio'
      }
      return 'Gateway timeout (synthesis took too long)'
    default:
      return `TTS server error (${status})`
  }
}

async function readErrorDetail(response: { text: () => Promise<string> }): Promise<string | null> {
  try {
    const text = await response.text()
    const trimmed = text.trim()
    if (!trimmed) return null
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>
        for (const key of ['error', 'detail', 'message']) {
          const value = record[key]
          if (typeof value === 'string' && value.trim()) return value.trim()
        }
      }
    } catch {
      // Plain-text gateway errors are fine; use the original body below.
    }
    return trimmed
  } catch {
    return null
  }
}

function isRetryableVoiceError(status: number): boolean {
  // Retry without voice on most error codes — Kokoro reports voice-not-found
  // as 502, so we can't limit to 4xx only. Skip only 503 (all engines down)
  // and 504 (timeout) where a different voice would not help.
  return status !== 503 && status !== 504
}

async function handleVoiceRetry<TPayload>(
  post: (payload: TPayload, signal?: AbortSignal) => Promise<Response>,
  buildPayload: (text: string, voice?: string) => TPayload,
  text: string,
  voice: string | undefined,
  signal: AbortSignal | undefined,
  options: {
    passthroughStatus?: (status: number) => boolean
    skipVoiceRetryStatus?: (status: number) => boolean
  } = {},
): Promise<Response> {
  let response = await post(buildPayload(text, voice), signal)

  if (
    !response.ok &&
    voice &&
    isRetryableVoiceError(response.status) &&
    !options.skipVoiceRetryStatus?.(response.status)
  ) {
    response = await post(buildPayload(text), signal)
  }

  if (!response.ok && options.passthroughStatus?.(response.status)) {
    return response
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    const base = mapStatusToMessage(response.status, detail)
    const message = detail ? `${base}: ${detail}` : base
    throw new TTSError(message, 'generation_failed')
  }

  return response
}

function isPcmEndpointUnsupportedStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 406 || status === 415 || status === 501
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Best-effort cleanup before falling back to the encoded stream endpoint.
  }
}

function parsePositiveIntHeader(headers: Headers, name: string, fallback: number): number {
  const rawValue = headers.get(name)
  if (!rawValue) return fallback
  const parsed = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseOptionalNumberHeader(headers: Headers, name: string): number | null {
  const rawValue = headers.get(name)
  if (!rawValue) return null
  const parsed = Number.parseFloat(rawValue)
  return Number.isFinite(parsed) ? parsed : null
}

function parseStreamResult(response: Response): GatewayStreamResult {
  if (!response.body) {
    throw new TTSError('Server returned no stream body', 'generation_failed')
  }

  const contentType = response.headers.get('content-type') ?? 'audio/mpeg'
  const mode = response.headers.get('x-tts-mode')
  const speedApplied = parseOptionalNumberHeader(response.headers, 'x-tts-speed-applied')
  if (mode === 'stream-pcm' || contentType.toLowerCase().startsWith('audio/raw')) {
    return {
      stream: response.body,
      speedApplied,
      format: {
        kind: 'raw-pcm',
        contentType,
        sampleRate: parsePositiveIntHeader(response.headers, 'x-tts-sample-rate', 24_000),
        channels: parsePositiveIntHeader(response.headers, 'x-tts-channels', 1),
        sampleWidth: parsePositiveIntHeader(response.headers, 'x-tts-sample-width', 2),
        pcmFormat: response.headers.get('x-tts-pcm-format') ?? 's16le',
      },
    }
  }

  return { stream: response.body, format: { kind: 'encoded', contentType }, speedApplied }
}

const unsupportedPcmStreamUrls = new Set<string>()

export function resetGatewayClientCacheForTest(): void {
  unsupportedPcmStreamUrls.clear()
}

export function createGatewayClient(baseUrl: string) {
  const syncUrl = resolveUrl(baseUrl, DEFAULT_SPEECH_PATH)
  const streamUrl = resolveUrl(baseUrl, DEFAULT_STREAM_PATH)
  const streamPcmUrl = resolvePcmStreamUrl(baseUrl)
  const warmupUrl = resolveWarmupUrl(baseUrl)

  function postForm(url: string) {
    return (payload: globalThis.FormData, signal?: AbortSignal): Promise<Response> =>
      fetch(url, {
        method: 'POST',
        body: payload,
        signal,
      })
  }

  function postJson(url: string) {
    return (payload: SpeechPayload, signal?: AbortSignal): Promise<Response> =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
  }

  const postSync = postForm(syncUrl)
  const postStream = postJson(streamUrl)
  const postStreamPcm = streamPcmUrl ? postJson(streamPcmUrl) : null

  return {
    async speakSync(
      text: string,
      voice?: string,
      signal?: AbortSignal,
    ): Promise<GatewaySpeechResult> {
      const response = await handleVoiceRetry(postSync, buildFormData, text, voice, signal)

      const audioBuffer = await response.arrayBuffer()
      const contentType = response.headers.get('content-type') ?? 'audio/mpeg'

      return { audio: Buffer.from(audioBuffer), contentType }
    },

    async speakStream(
      text: string,
      voice?: string,
      signal?: AbortSignal,
      speed?: number,
    ): Promise<GatewayStreamResult> {
      const buildStreamPayload = (payloadText: string, payloadVoice?: string): SpeechPayload =>
        buildJsonPayload(payloadText, payloadVoice, speed)
      const pcmUrl = streamPcmUrl
      if (postStreamPcm && pcmUrl && !unsupportedPcmStreamUrls.has(pcmUrl)) {
        const pcmResponse = await handleVoiceRetry(
          postStreamPcm,
          buildStreamPayload,
          text,
          voice,
          signal,
          {
            passthroughStatus: () => true,
            skipVoiceRetryStatus: isPcmEndpointUnsupportedStatus,
          },
        )
        if (pcmResponse.ok) {
          return parseStreamResult(pcmResponse)
        }
        if (isPcmEndpointUnsupportedStatus(pcmResponse.status)) {
          unsupportedPcmStreamUrls.add(pcmUrl)
        }
        await discardResponse(pcmResponse)
      }

      const response = await handleVoiceRetry(postStream, buildStreamPayload, text, voice, signal)
      return parseStreamResult(response)
    },

    async warmup(signal?: AbortSignal): Promise<void> {
      if (!warmupUrl) return
      try {
        const response = await fetch(warmupUrl, { method: 'POST', signal })
        await response.body?.cancel().catch(() => {})
      } catch {
        // Warmup must never affect the main app startup path.
      }
    },
  }
}
