import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { TTSError, type AppConfig, type TTSErrorType, type Voice } from '../types'
import { cleanTextForSpeech } from '../ui/utils/markdown'
import { detectPlayer, spawnAfplay, type PlayerProcess } from './audio-player'
import { createGatewayClient, DEFAULT_SERVER_URL } from './gateway-client'
import { createPlaybackGate, type PlaybackGate } from './playback-gate'
import { splitIntoSentences } from './speech-text'

// Single process-global playback control owner. createStreamSession's playback
// loop and the file-based playAudio path both coordinate stop/pause/resume
// through this gate. Exported so the streaming controller binds to the same
// instance instead of reaching for loose module variables.
export const playbackGate: PlaybackGate = createPlaybackGate()

export interface StreamSession {
  done: Promise<void>
  kill: () => void
  pause: () => void
  resume: () => void
  readonly wasKilled: boolean
}

export function createStreamSession(
  audioStream: ReadableStream<Uint8Array>,
  speed: number,
  gate: PlaybackGate = playbackGate,
): StreamSession {
  let killed = false
  let proc: PlayerProcess | null = null
  let activeReader: ReturnType<ReadableStream<Uint8Array>['getReader']> | null = null

  const player = detectPlayer()

  const done = (async () => {
    const controlVersion = gate.snapshotVersion()
    if (!(await gate.waitUntilReady(controlVersion)) || killed) {
      return
    }

    proc = player.spawn(speed)
    const writer = proc.writer
    const reader = audioStream.getReader()
    activeReader = reader

    try {
      while (true) {
        if (gate.isPaused() || controlVersion !== gate.snapshotVersion()) {
          if (!(await gate.waitUntilReady(controlVersion))) break
        }
        if (killed) break
        const { done: readerDone, value } = await reader.read()
        if (readerDone || killed) break
        try {
          writer.write(value)
        } catch {
          break // Pipe broken (player exited); fall through to exit-code check
        }
      }
    } catch (err) {
      if (!killed) throw err
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // Bun can throw here for delayed fetch response bodies even after a
        // successful read loop; cleanup should not fail playback completion.
      }
      activeReader = null
      try {
        writer.end()
      } catch {
        /* pipe may already be closed */
      }
    }

    const exitCode = await proc.exited
    await proc.cleanup?.()
    proc = null

    if (exitCode !== 0 && !killed) {
      throw new TTSError(`Player exited with code ${exitCode}`, 'audio_playback')
    }
  })()

  return {
    done,
    kill() {
      killed = true
      activeReader?.cancel().catch(() => {})
      proc?.kill()
    },
    pause() {
      if (killed || !proc) return
      proc.pause()
    },
    resume() {
      if (killed || !proc) return
      proc.resume()
    },
    get wasKilled() {
      return killed
    },
  }
}

const DEFAULT_SAY_RATE_WPM = 175
const SAY_VOICE_BY_ORB_VOICE: Record<Voice, string> = {
  alba: 'Samantha',
  marius: 'Daniel',
  jean: 'Eddy (English (US))',
}

function categorizeTTSError(err: unknown, context: 'generate' | 'playback'): TTSError {
  if (err instanceof TTSError) return err

  const error = err instanceof Error ? err : new Error(String(err))
  const nodeError = error as Error & { code?: string }

  if (nodeError.code === 'ENOENT') {
    const cmd = context === 'generate' ? 'say' : 'afplay'
    return new TTSError(`Command not found: ${cmd}`, 'command_not_found', error)
  }

  const type: TTSErrorType = context === 'generate' ? 'generation_failed' : 'audio_playback'
  return new TTSError(error.message, type, error)
}

export function wasPlaybackStopped(): boolean {
  return playbackGate.wasStopped()
}

export function resetPlaybackStoppedFlag(): void {
  playbackGate.resetStopped()
}

function isValidSpeed(speed: number | undefined): speed is number {
  return typeof speed === 'number' && Number.isFinite(speed) && speed > 0
}

function getTempAudioExtension(mode: AppConfig['ttsMode']): string {
  return mode === 'generate' ? 'aiff' : 'mp3'
}

export function createTempAudioPath(mode: AppConfig['ttsMode'], name: string): string {
  return join(tmpdir(), `${name}.${getTempAudioExtension(mode)}`)
}

function mapVoiceToSayVoice(voice: Voice): string {
  return SAY_VOICE_BY_ORB_VOICE[voice]
}

function mapSpeedToSayRate(speed: number): number | undefined {
  if (!isValidSpeed(speed)) return undefined
  return Math.max(90, Math.round(DEFAULT_SAY_RATE_WPM * speed))
}

async function runGenerateCommand(
  text: string,
  voice: Voice,
  speed: number,
  outputPath: string,
): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new TTSError(
      'Generate mode requires macOS say. Use serve mode with tts-gateway on this platform.',
      'command_not_found',
    )
  }

  async function runSay(voiceName?: string): Promise<number> {
    const cmd = ['say', '-o', outputPath]
    if (voiceName) {
      cmd.push('-v', voiceName)
    }

    const rate = mapSpeedToSayRate(speed)
    if (rate) {
      cmd.push('-r', String(rate))
    }

    cmd.push(text)

    const proc = Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' })
    return await proc.exited
  }

  const sayVoice = mapVoiceToSayVoice(voice)
  let exitCode = await runSay(sayVoice)
  if (exitCode !== 0 && sayVoice) {
    exitCode = await runSay()
  }

  if (exitCode !== 0) {
    throw new TTSError(`say exited with code ${exitCode}`, 'generation_failed')
  }
}

export async function generateAudio(
  text: string,
  config: AppConfig,
  outputPath: string,
  signal?: globalThis.AbortSignal,
): Promise<void> {
  try {
    if (config.ttsMode === 'serve') {
      const client = createGatewayClient(config.ttsServerUrl ?? DEFAULT_SERVER_URL)
      const result = await client.speakSync(text, config.ttsVoice, signal)
      await Bun.write(outputPath, result.audio)
      return
    }

    await runGenerateCommand(text, config.ttsVoice, config.ttsSpeed, outputPath)
  } catch (err) {
    throw categorizeTTSError(err, 'generate')
  }
}

export async function playAudio(path: string, speed?: number): Promise<void> {
  const controlVersion = playbackGate.snapshotVersion()

  if (!(await playbackGate.waitUntilReady(controlVersion))) {
    return
  }

  try {
    playbackGate.setCurrentProcess(spawnAfplay(path, isValidSpeed(speed) ? speed : undefined))
  } catch (err) {
    playbackGate.setCurrentProcess(null)
    throw categorizeTTSError(err, 'playback')
  }

  const proc = playbackGate.getCurrentProcess()
  if (!proc) {
    throw new TTSError('Audio playback failed to start', 'audio_playback')
  }

  const exitCode = await proc.exited
  playbackGate.setCurrentProcess(null)

  const wasManualStop = playbackGate.wasStopped()
  if (wasManualStop) {
    resetPlaybackStoppedFlag()
  }

  if (exitCode !== 0 && !wasManualStop) {
    throw new TTSError(`afplay exited with code ${exitCode}`, 'audio_playback')
  }
}

export function stopSpeaking(): void {
  playbackGate.stopAll()
}

export function pauseSpeaking(): void {
  playbackGate.pause()
}

export function resumeSpeaking(): void {
  playbackGate.resume()
}

export async function speak(text: string, config: AppConfig): Promise<void> {
  if (!config.ttsEnabled) return

  const cleanText = cleanTextForSpeech(text)
  if (!cleanText) return

  const sentences = splitIntoSentences(cleanText)
  let spokenCount = 0
  let firstError: TTSError | null = null

  for (const [i, sentence] of sentences.entries()) {
    const audioPath = createTempAudioPath(config.ttsMode, `tts-${Date.now()}-${i}`)

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
