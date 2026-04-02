import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import { TTSError } from '../types'

export const DEFAULT_SERVER_URL = 'http://localhost:8000'
const DEFAULT_SPEECH_PATH = '/v1/speech'
const DEFAULT_STREAM_PATH = '/tts/stream'

export interface GatewaySpeechResult {
  audio: Buffer
  contentType: string
}

function resolveUrl(rawUrl: string, defaultPath: string): string {
  const trimmed = rawUrl.trim() || DEFAULT_SERVER_URL

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new TTSError('Invalid TTS server URL', 'generation_failed')
  }

  if (!url.pathname || url.pathname === '/') {
    url.pathname = defaultPath
  }

  return url.toString()
}

function buildFormData(text: string, voice?: string): globalThis.FormData {
  const formData = new globalThis.FormData()
  formData.append('text', text)
  if (voice) {
    formData.append('voice', voice)
  }
  return formData
}

function mapStatusToMessage(status: number): string {
  switch (status) {
    case 422:
      return 'Gateway rejected request: empty or invalid text'
    case 502:
      return 'Gateway engine failure'
    case 503:
      return 'Gateway unavailable (no TTS engines running)'
    case 504:
      return 'Gateway timeout (synthesis took too long)'
    default:
      return `TTS server error (${status})`
  }
}

async function readErrorDetail(response: { text: () => Promise<string> }): Promise<string | null> {
  try {
    const text = await response.text()
    return text.trim() || null
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

async function handleVoiceRetry(
  post: (formData: globalThis.FormData, signal?: AbortSignal) => Promise<Response>,
  text: string,
  voice: string | undefined,
  signal: AbortSignal | undefined,
): Promise<Response> {
  let response = await post(buildFormData(text, voice), signal)

  if (!response.ok && voice && isRetryableVoiceError(response.status)) {
    response = await post(buildFormData(text), signal)
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response)
    const base = mapStatusToMessage(response.status)
    const message = detail ? `${base}: ${detail}` : base
    throw new TTSError(message, 'generation_failed')
  }

  return response
}

export function createGatewayClient(baseUrl: string) {
  const syncUrl = resolveUrl(baseUrl, DEFAULT_SPEECH_PATH)
  const streamUrl = resolveUrl(baseUrl, DEFAULT_STREAM_PATH)

  function postTo(url: string) {
    return (formData: globalThis.FormData, signal?: AbortSignal): Promise<Response> =>
      fetch(url, { method: 'POST', body: formData, signal })
  }

  const postSync = postTo(syncUrl)
  const postStream = postTo(streamUrl)

  return {
    async speakSync(
      text: string,
      voice?: string,
      signal?: AbortSignal,
    ): Promise<GatewaySpeechResult> {
      const response = await handleVoiceRetry(postSync, text, voice, signal)

      const audioBuffer = await response.arrayBuffer()
      const contentType = response.headers.get('content-type') ?? 'audio/mpeg'

      return { audio: Buffer.from(audioBuffer), contentType }
    },

    async speakStream(
      text: string,
      voice?: string,
      signal?: AbortSignal,
    ): Promise<ReadableStream<Uint8Array>> {
      const response = await handleVoiceRetry(postStream, text, voice, signal)

      if (!response.body) {
        throw new TTSError('Server returned no stream body', 'generation_failed')
      }

      return response.body
    },
  }
}
