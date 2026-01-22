import { spawn } from 'child_process'
import { Buffer } from 'buffer'
import { URL } from 'url'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlink, writeFile } from 'fs/promises'
import { TTSError, type AppConfig, type TTSErrorType } from '../types'
import { cleanTextForSpeech } from '../ui/utils/markdown'

// Re-export for backward compatibility with existing consumers
export { cleanTextForSpeech }

const DEFAULT_SERVER_URL = 'http://localhost:8000'

export function categorizeTTSError(err: unknown, context: 'generate' | 'playback'): TTSError {
  if (err instanceof TTSError) return err

  const error = err instanceof Error ? err : new Error(String(err))
  const nodeError = error as Error & { code?: string }

  if (nodeError.code === 'ENOENT') {
    const cmd = context === 'generate' ? 'pocket-tts' : 'afplay'
    return new TTSError(`Command not found: ${cmd}`, 'command_not_found', error)
  }

  const type: TTSErrorType = context === 'generate' ? 'generation_failed' : 'audio_playback'
  return new TTSError(error.message, type, error)
}

let currentPlayProcess: ReturnType<typeof spawn> | null = null
let playbackStoppedManually = false

export function wasPlaybackStopped(): boolean {
  return playbackStoppedManually
}

export function resetPlaybackStoppedFlag(): void {
  playbackStoppedManually = false
}

export function splitIntoSentences(text: string): string[] {
  const sentences: string[] = []
  let current = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === undefined) continue

    current += char

    if (['.', '!', '?'].includes(char)) {
      const next = text[i + 1]
      if (next === undefined || next === ' ' || next === '\n') {
        const trimmed = current.trim()
        if (trimmed.length > 0) {
          sentences.push(trimmed)
        }
        current = ''
      }
    }
  }

  const trimmed = current.trim()
  if (trimmed.length > 0) {
    sentences.push(trimmed)
  }

  return sentences
}

function normalizeServerUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim() || DEFAULT_SERVER_URL

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new TTSError('Invalid Pocket TTS server URL', 'generation_failed')
  }

  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/tts'
  }

  return url.toString()
}

async function readErrorMessage(response: { text: () => Promise<string> }): Promise<string | null> {
  try {
    const text = await response.text()
    return text.trim() || null
  } catch {
    return null
  }
}

function isValidSpeed(speed: number | undefined): speed is number {
  return speed !== undefined && Number.isFinite(speed) && speed > 0
}

async function requestServerSpeech(
  serverUrl: string,
  text: string,
  voice: string,
  speed: number,
): Promise<Buffer> {
  const formData = new globalThis.FormData()
  formData.append('text', text)
  if (voice) {
    formData.append('voice_url', voice)
  }
  if (isValidSpeed(speed)) {
    formData.append('speed', String(speed))
  }

  const response = await fetch(serverUrl, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const message = await readErrorMessage(response)
    const details = message ? `: ${message}` : ''
    throw new TTSError(
      `Pocket TTS server error (${response.status})${details}`,
      'generation_failed',
    )
  }

  const audioBuffer = await response.arrayBuffer()
  return Buffer.from(audioBuffer)
}

async function runGenerateCommand(
  text: string,
  voice: string,
  speed: number,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['generate', '--text', text, '--voice', voice, '-o', outputPath]
    if (isValidSpeed(speed)) {
      args.push('--speed', String(speed))
    }
    const proc = spawn('pocket-tts', args)

    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new TTSError(`pocket-tts exited with code ${code}`, 'generation_failed'))
      }
    })

    proc.on('error', (err) => {
      reject(categorizeTTSError(err, 'generate'))
    })
  })
}

export async function generateAudio(
  text: string,
  config: AppConfig,
  outputPath: string,
): Promise<void> {
  try {
    if (config.ttsMode === 'serve') {
      const serverUrl = normalizeServerUrl(config.ttsServerUrl ?? DEFAULT_SERVER_URL)
      const audio = await requestServerSpeech(serverUrl, text, config.ttsVoice, config.ttsSpeed)
      await writeFile(outputPath, audio)
      return
    }

    await runGenerateCommand(text, config.ttsVoice, config.ttsSpeed, outputPath)
  } catch (err) {
    throw categorizeTTSError(err, 'generate')
  }
}

export async function playAudio(path: string, speed?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    resetPlaybackStoppedFlag()
    const args = isValidSpeed(speed) ? [path, '-r', String(speed)] : [path]
    currentPlayProcess = spawn('afplay', args)

    currentPlayProcess.on('close', (code) => {
      currentPlayProcess = null
      const success = code === 0 || playbackStoppedManually
      if (playbackStoppedManually) {
        resetPlaybackStoppedFlag()
      }
      if (success) {
        resolve()
      } else {
        reject(new TTSError(`afplay exited with code ${code}`, 'audio_playback'))
      }
    })

    currentPlayProcess.on('error', (err) => {
      currentPlayProcess = null
      reject(categorizeTTSError(err, 'playback'))
    })
  })
}

export function stopSpeaking(): void {
  if (currentPlayProcess) {
    playbackStoppedManually = true
    currentPlayProcess.kill()
    currentPlayProcess = null
  }
}

export async function speak(text: string, config: AppConfig): Promise<void> {
  if (!config.ttsEnabled) return

  const cleanText = cleanTextForSpeech(text)
  if (!cleanText) return

  const sentences = splitIntoSentences(cleanText)
  let spokenCount = 0
  let firstError: TTSError | null = null

  for (const [i, sentence] of sentences.entries()) {
    const audioPath = join(tmpdir(), `tts-${Date.now()}-${i}.wav`)

    try {
      await generateAudio(sentence, config, audioPath)
      await playAudio(audioPath, config.ttsSpeed)
      spokenCount += 1
    } catch (err) {
      if (err instanceof TTSError) {
        if (err.type === 'command_not_found') {
          throw err // Fatal - no point continuing
        }
        firstError ??= err
        if (config.ttsMode === 'serve') {
          throw err
        }
      } else {
        firstError ??= categorizeTTSError(err, 'generate')
      }
    } finally {
      await unlink(audioPath).catch(() => {})
    }
  }

  if (spokenCount === 0 && firstError) {
    throw firstError
  }
}

export async function speakQuick(text: string, config: AppConfig): Promise<void> {
  if (!config.ttsEnabled) return

  const audioPath = join(tmpdir(), `tts-quick-${Date.now()}.wav`)

  try {
    await generateAudio(text, config, audioPath)
    await playAudio(audioPath, config.ttsSpeed)
  } finally {
    await unlink(audioPath).catch(() => {})
  }
}
