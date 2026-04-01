import { Buffer } from 'node:buffer'
import { URL } from 'node:url'
import { TTSError } from '../types'

export const DEFAULT_SERVER_URL = 'http://localhost:8000'
const DEFAULT_SPEECH_PATH = '/v1/speech'

export interface GatewaySpeechResult {
  audio: Buffer
  contentType: string
}

function normalizeGatewayUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim() || DEFAULT_SERVER_URL

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new TTSError('Invalid TTS server URL', 'generation_failed')
  }

  if (!url.pathname || url.pathname === '/') {
    url.pathname = DEFAULT_SPEECH_PATH
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

export function createGatewayClient(baseUrl: string) {
  const url = normalizeGatewayUrl(baseUrl)

  async function postSpeech(
    formData: globalThis.FormData,
    signal?: AbortSignal,
  ): Promise<Response> {
    return await fetch(url, { method: 'POST', body: formData, signal })
  }

  return {
    async speakSync(
      text: string,
      voice?: string,
      signal?: AbortSignal,
    ): Promise<GatewaySpeechResult> {
      let response = await postSpeech(buildFormData(text, voice), signal)

      if (!response.ok && voice && isRetryableVoiceError(response.status)) {
        // Voice mismatch — Kokoro reports missing voices as 502, other gateways
        // may use 4xx. Retry without voice so the server can use its default.
        // Skip 503/504 where the issue is engine availability, not voice.
        response = await postSpeech(buildFormData(text), signal)
      }

      if (!response.ok) {
        const detail = await readErrorDetail(response)
        const base = mapStatusToMessage(response.status)
        const message = detail ? `${base}: ${detail}` : base
        throw new TTSError(message, 'generation_failed')
      }

      const audioBuffer = await response.arrayBuffer()
      const contentType = response.headers.get('content-type') ?? 'audio/mpeg'

      return { audio: Buffer.from(audioBuffer), contentType }
    },
  }
}
