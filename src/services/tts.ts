import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TTSError, type AppConfig, type TTSErrorType, type Voice } from '../types'
import {
  detectPlayer,
  ENCODED_STREAM_AUDIO_FORMAT,
  spawnAfplay,
  type PlayerProcess,
  type StreamAudioFormat,
} from './audio-player'
import { createGatewayClient, DEFAULT_SERVER_URL } from './gateway-client'
import { createPlaybackGate, type PlaybackGate } from './playback-gate'

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

export interface PlaybackSink {
  writeStream(stream: ReadableStream<Uint8Array>): Promise<void>
  finish(): Promise<void>
  kill: () => void
  pause: () => void
  resume: () => void
  readonly wasKilled: boolean
}

const RAW_PCM_PREROLL_MS = 300
// A slow gateway must degrade to the old start-immediately behavior, not push
// the start of speech out indefinitely while preroll waits for bytes.
const RAW_PCM_PREROLL_TIMEOUT_MS = 1000

interface AudioStreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
  cancel(reason?: unknown): Promise<void>
  releaseLock(): void
}

type AudioRead = Promise<{ done: boolean; value?: Uint8Array }>

interface PrerollResult {
  chunks: Uint8Array[]
  done: boolean
  // Read that was in flight when the preroll timed out. The caller must
  // consume it before calling reader.read() again or its chunk is lost.
  pendingRead: AudioRead | null
}

function getRawPcmPrerollBytes(format: StreamAudioFormat): number {
  if (format.kind !== 'raw-pcm') return 0
  return Math.ceil(
    (format.sampleRate * format.channels * format.sampleWidth * RAW_PCM_PREROLL_MS) / 1000,
  )
}

async function readPrerollChunks(
  reader: AudioStreamReader,
  format: StreamAudioFormat,
  shouldStop: () => boolean,
): Promise<PrerollResult> {
  const targetBytes = getRawPcmPrerollBytes(format)
  const chunks: Uint8Array[] = []
  let bufferedBytes = 0
  if (targetBytes === 0) return { chunks, done: false, pendingRead: null }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), RAW_PCM_PREROLL_TIMEOUT_MS)
  })

  try {
    while (!shouldStop() && bufferedBytes < targetBytes) {
      const read = reader.read()
      const result = await Promise.race([read, timeout])
      if (result === 'timeout') {
        read.catch(() => {}) // may be abandoned if playback stops first
        return { chunks, done: false, pendingRead: read }
      }
      const { done, value } = result
      if (done || !value) return { chunks, done: true, pendingRead: null }
      chunks.push(value)
      bufferedBytes += value.byteLength
    }
    return { chunks, done: false, pendingRead: null }
  } finally {
    clearTimeout(timer)
  }
}

export function createStreamSession(
  audioStream: ReadableStream<Uint8Array>,
  speed: number,
  gate: PlaybackGate = playbackGate,
  format: StreamAudioFormat = ENCODED_STREAM_AUDIO_FORMAT,
): StreamSession {
  let killed = false
  let proc: PlayerProcess | null = null
  let activeReader: AudioStreamReader | null = null

  const player = detectPlayer()

  const done = (async () => {
    const controlVersion = gate.snapshotVersion()
    if (!(await gate.waitUntilReady(controlVersion)) || killed) {
      return
    }

    const reader = audioStream.getReader()
    activeReader = reader
    let streamEnded = false

    try {
      const preroll = await readPrerollChunks(reader, format, () => killed)
      streamEnded = preroll.done
      let pendingRead = preroll.pendingRead

      if (gate.isPaused() || controlVersion !== gate.snapshotVersion()) {
        if (!(await gate.waitUntilReady(controlVersion))) return
      }
      if (killed) return

      proc = player.spawn(speed, format)
      const writer = proc.writer
      let pipeBroken = false

      for (const chunk of preroll.chunks) {
        try {
          await writer.write(chunk)
        } catch {
          pipeBroken = true
          break // Pipe broken (player exited); fall through to exit-code check
        }
      }

      while (!streamEnded && !pipeBroken) {
        if (gate.isPaused() || controlVersion !== gate.snapshotVersion()) {
          if (!(await gate.waitUntilReady(controlVersion))) break
        }
        if (killed) break
        const { done: readerDone, value } = await (pendingRead ?? reader.read())
        pendingRead = null
        if (readerDone || killed || !value) break
        try {
          await writer.write(value)
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
        await proc?.writer.end()
      } catch {
        /* pipe may already be closed */
      }
    }

    if (!proc) return

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

export function createPlaybackSink(
  speed: number,
  format: StreamAudioFormat,
  gate: PlaybackGate = playbackGate,
): PlaybackSink {
  let killed = false
  let finished = false
  let proc: PlayerProcess | null = null
  let activeReader: AudioStreamReader | null = null
  let exitCode: number | null = null
  let exitError: unknown = null

  const player = detectPlayer()
  const controlVersion = gate.snapshotVersion()

  async function ensureStarted(): Promise<PlayerProcess | null> {
    if (proc) return proc
    if (!(await gate.waitUntilReady(controlVersion)) || killed) return null

    proc = player.spawn(speed, format)
    void proc.exited
      .then((code) => {
        exitCode = code
      })
      .catch((err) => {
        exitError = err
      })
    return proc
  }

  function throwIfExited(): void {
    if (exitError) {
      const message = exitError instanceof Error ? exitError.message : String(exitError)
      const original = exitError instanceof Error ? exitError : undefined
      throw new TTSError(message, 'audio_playback', original)
    }
    if (exitCode !== null && !killed) {
      throw new TTSError(`Player exited with code ${exitCode}`, 'audio_playback')
    }
  }

  async function writeStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    if (finished) {
      throw new TTSError('Playback sink already finished', 'audio_playback')
    }

    const reader = stream.getReader()
    activeReader = reader
    let streamEnded = false

    try {
      const preroll: PrerollResult = proc
        ? { chunks: [], done: false, pendingRead: null }
        : await readPrerollChunks(reader, format, () => killed)
      streamEnded = preroll.done
      let pendingRead = preroll.pendingRead

      const started = await ensureStarted()
      if (!started) return

      const writer = started.writer

      for (const chunk of preroll.chunks) {
        throwIfExited()
        try {
          await writer.write(chunk)
        } catch (err) {
          if (!killed) {
            const original = err instanceof Error ? err : undefined
            throw new TTSError('Player pipe closed during playback', 'audio_playback', original)
          }
          streamEnded = true
          break
        }
      }

      while (!streamEnded) {
        throwIfExited()
        if (gate.isPaused() || controlVersion !== gate.snapshotVersion()) {
          if (!(await gate.waitUntilReady(controlVersion))) break
        }
        if (killed) break
        const { done: readerDone, value } = await (pendingRead ?? reader.read())
        pendingRead = null
        if (readerDone || killed || !value) break
        try {
          await writer.write(value)
        } catch (err) {
          if (!killed) {
            const original = err instanceof Error ? err : undefined
            throw new TTSError('Player pipe closed during playback', 'audio_playback', original)
          }
          break
        }
      }
      throwIfExited()
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
    }
  }

  async function finish(): Promise<void> {
    if (finished) return
    finished = true

    const started = await ensureStarted()
    if (!started) return

    try {
      await started.writer.end()
    } catch {
      /* pipe may already be closed */
    }

    const code = await started.exited
    exitCode = code
    await started.cleanup?.()
    proc = null

    if (code !== 0 && !killed) {
      throw new TTSError(`Player exited with code ${code}`, 'audio_playback')
    }
  }

  return {
    writeStream,
    finish,
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
