// Audio player backend: detects an installed CLI player (mpv or ffplay) and
// wraps it in a uniform PlayerProcess (write/kill/pause/resume) the streaming
// layer drives. This is the only place that knows player-specific spawn args
// and pause mechanics (mpv IPC socket vs. ffplay control pipe).

import { spawn as spawnChildProcess } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Writable } from 'node:stream'
import { TTSError } from '../types'

type PlayerBinary = 'mpv' | 'ffplay'

interface PlayerConfig {
  binary: PlayerBinary
  spawn: (speed: number, format: StreamAudioFormat) => PlayerProcess
}

export interface PlayerProcess {
  writer: {
    write: (data: Uint8Array) => Promise<void>
    end: () => Promise<void>
  }
  exited: Promise<number>
  kill: () => void
  pause: () => void
  resume: () => void
  cleanup?: () => Promise<void>
  pid: number | undefined
}

export type StreamAudioFormat =
  | { kind: 'encoded' }
  | {
      kind: 'raw-pcm'
      sampleRate: number
      channels: number
      sampleWidth: number
      pcmFormat: string
    }

export const ENCODED_STREAM_AUDIO_FORMAT: StreamAudioFormat = { kind: 'encoded' }

async function writeBunSink(sink: Bun.FileSink, data: Uint8Array): Promise<void> {
  await sink.write(data)
  if (typeof sink.flush === 'function') {
    await sink.flush()
  }
}

async function endBunSink(sink: Bun.FileSink): Promise<void> {
  await sink.end()
}

function writeNodeWritable(stream: Writable, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const canListen = typeof stream.once === 'function' && typeof stream.off === 'function'

    const finish = (err?: Error | null) => {
      if (settled) return
      settled = true
      if (canListen) {
        stream.off('error', onError)
        stream.off('close', onClose)
        stream.off('drain', onDrain)
      }
      if (err) reject(err)
      else resolve()
    }

    const onError = (err: Error) => finish(err)
    const onClose = () => finish(new Error('Player pipe closed'))
    const onDrain = () => finish()

    // Bun does not settle a pending pipe write when the reading process dies:
    // no callback, no 'error'. The player's kill/exit paths destroy the stream
    // instead, so 'close' is the signal that keeps this promise from hanging.
    if (stream.destroyed) {
      finish(new Error('Player pipe closed'))
      return
    }
    if (canListen) {
      stream.once('error', onError)
      stream.once('close', onClose)
    }

    try {
      if (stream.write.length < 2) {
        const ready = stream.write(data)
        if (ready === false && canListen) {
          stream.once('drain', onDrain)
        } else {
          finish()
        }
        return
      }
      stream.write(data, finish)
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

function endNodeWritable(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const canListen = typeof stream.once === 'function' && typeof stream.off === 'function'

    const finish = (err?: Error | null) => {
      if (settled) return
      settled = true
      if (canListen) {
        stream.off('error', onError)
        stream.off('close', onClose)
      }
      if (err) reject(err)
      else resolve()
    }

    const onError = (err: Error) => finish(err)
    // Ending a pipe whose reader died is done, not an error worth surfacing.
    const onClose = () => finish()

    if (stream.destroyed) {
      finish()
      return
    }
    if (canListen) {
      stream.once('error', onError)
      stream.once('close', onClose)
    }

    try {
      if (stream.end.length < 1) {
        stream.end()
        finish()
        return
      }
      stream.end(finish)
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

const PLAYERS: PlayerConfig[] = [
  { binary: 'mpv', spawn: spawnMpv },
  { binary: 'ffplay', spawn: spawnFfplay },
]

function spawnMpv(speed: number, format: StreamAudioFormat): PlayerProcess {
  const ipcSocket = join(
    tmpdir(),
    `orb-mpv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sock`,
  )
  const args = [
    '--no-video',
    '--no-terminal',
    '--msg-level=all=error',
    `--input-ipc-server=${ipcSocket}`,
  ]
  if (speed !== 1) args.push(`--speed=${speed}`)
  if (format.kind === 'raw-pcm') {
    args.push(
      '--demuxer=rawaudio',
      `--demuxer-rawaudio-rate=${format.sampleRate}`,
      `--demuxer-rawaudio-channels=${format.channels}`,
      `--demuxer-rawaudio-format=${format.pcmFormat}`,
    )
  }
  args.push('-')
  return createMpvProcess(args, ipcSocket)
}

function spawnFfplay(speed: number, format: StreamAudioFormat): PlayerProcess {
  const args = ['-nodisp', '-autoexit', '-loglevel', 'error']
  if (speed !== 1) {
    const clamped = Math.max(0.5, Math.min(2.0, speed))
    args.push('-af', `atempo=${clamped}`)
  }
  if (format.kind === 'raw-pcm') {
    args.push(...buildFfplayRawPcmArgs(format))
  }
  args.push('-i', 'pipe:3')
  return createFfplayProcess(args)
}

const UNKNOWN_FFPLAY_MAJOR_VERSION = Number.POSITIVE_INFINITY
let detectedFfplayMajorVersion: number | undefined = undefined

export function parseFfplayMajorVersion(versionOutput: string): number | undefined {
  const releaseMajor = Number.parseInt(
    versionOutput.match(/ffplay version\s+(?:n)?(\d+)(?=[.\s-]|$)/i)?.[1] ?? '',
    10,
  )
  if (Number.isFinite(releaseMajor)) return releaseMajor

  const libavutilMajor = Number.parseInt(versionOutput.match(/libavutil\s+(\d+)\./i)?.[1] ?? '', 10)
  if (!Number.isFinite(libavutilMajor)) return undefined
  if (libavutilMajor <= 56) return 4
  return libavutilMajor - 52
}

function detectFfplayMajorVersion(): number {
  if (detectedFfplayMajorVersion !== undefined) return detectedFfplayMajorVersion

  try {
    const result = Bun.spawnSync(['ffplay', '-version'], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const text = new TextDecoder().decode(result.stdout)
    detectedFfplayMajorVersion = parseFfplayMajorVersion(text) ?? UNKNOWN_FFPLAY_MAJOR_VERSION
  } catch {
    detectedFfplayMajorVersion = UNKNOWN_FFPLAY_MAJOR_VERSION
  }

  return detectedFfplayMajorVersion
}

export function buildFfplayRawPcmArgs(
  format: Extract<StreamAudioFormat, { kind: 'raw-pcm' }>,
  ffplayMajorVersion = detectFfplayMajorVersion(),
): string[] {
  if (ffplayMajorVersion < 5) {
    return [
      '-f',
      format.pcmFormat,
      '-ar',
      String(format.sampleRate),
      '-ac',
      String(format.channels),
    ]
  }

  return [
    '-f',
    format.pcmFormat,
    '-sample_rate',
    String(format.sampleRate),
    '-ch_layout',
    channelLayoutForChannels(format.channels),
  ]
}

function channelLayoutForChannels(channels: number): string {
  if (channels === 1) return 'mono'
  if (channels === 2) return 'stereo'
  return `${channels}c`
}

function normalizeExitCode(code: number | null, signal: NodeJS.Signals | null): number {
  if (typeof code === 'number') return code
  return signal ? 1 : 0
}

function createFfplayProcess(args: string[]): PlayerProcess {
  return wrapFfplayProcess(
    spawnChildProcess('ffplay', args, {
      stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
    }),
  )
}

/** Structural subset of ChildProcess so tests can drive the wiring with fakes. */
export interface FfplayProcessLike {
  stdin: Writable | null
  stdio: ReadonlyArray<unknown>
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  once(event: 'error', listener: (err: Error) => void): this
  kill(): void
  pid?: number | undefined
}

export function wrapFfplayProcess(proc: FfplayProcessLike): PlayerProcess {
  const control = proc.stdin
  const audioWriter = proc.stdio[3] as Writable | null

  if (!control || !audioWriter) {
    proc.kill()
    throw new TTSError('ffplay failed to open control pipes', 'audio_playback')
  }

  const togglePause = () => {
    try {
      control.write('p')
    } catch {
      /* process already exited */
    }
  }

  // On Bun, a pipe write pending on a full buffer never settles once ffplay
  // stops reading — killing the process fires neither the write callback nor
  // an 'error'/'close' on the stream. Destroying the writer does, so any
  // in-flight writeNodeWritable resolves instead of hanging playback forever.
  const destroyPipes = () => {
    try {
      audioWriter.destroy()
    } catch {
      /* already closed */
    }
    try {
      control.destroy()
    } catch {
      /* already closed */
    }
  }
  proc.once('exit', destroyPipes)
  proc.once('error', destroyPipes)

  return {
    writer: {
      async write(data: Uint8Array) {
        await writeNodeWritable(audioWriter, data)
      },
      async end() {
        await endNodeWritable(audioWriter)
      },
    },
    exited: new Promise<number>((resolve, reject) => {
      proc.once('error', reject)
      proc.once('exit', (code, signal) => resolve(normalizeExitCode(code, signal)))
    }),
    kill() {
      proc.kill()
      destroyPipes()
    },
    pause() {
      togglePause()
    },
    resume() {
      togglePause()
    },
    pid: proc.pid,
  }
}

function createMpvProcess(args: string[], ipcSocket: string): PlayerProcess {
  const proc = Bun.spawn(['mpv', ...args], {
    stdin: 'pipe',
    stdout: 'ignore',
    stderr: 'ignore',
  })

  return {
    writer: {
      async write(data: Uint8Array) {
        await writeBunSink(proc.stdin, data)
      },
      async end() {
        await endBunSink(proc.stdin)
      },
    },
    exited: proc.exited,
    kill() {
      proc.kill()
    },
    pause() {
      // mpv flushes its audio buffer cleanly on IPC pause.
      void sendMpvCommand(ipcSocket, ['set_property', 'pause', true])
    },
    resume() {
      void sendMpvCommand(ipcSocket, ['set_property', 'pause', false])
    },
    cleanup() {
      return unlink(ipcSocket).catch(() => {})
    },
    pid: proc.pid,
  }
}

function sendMpvCommand(socketPath: string, command: unknown[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const socket = createConnection(socketPath)
      socket.on('error', () => resolve())
      socket.on('connect', () => {
        socket.write(JSON.stringify({ command }) + '\n', () => {
          socket.end()
          resolve()
        })
      })
    } catch {
      resolve()
    }
  })
}

let detectedPlayer: PlayerConfig | null | undefined = undefined

function throwPlayerNotFound(): never {
  throw new TTSError('No audio player found. Install mpv: brew install mpv', 'player_not_found')
}

export function detectPlayer(): PlayerConfig {
  if (detectedPlayer !== undefined) {
    if (detectedPlayer === null) throwPlayerNotFound()
    return detectedPlayer
  }

  for (const player of PLAYERS) {
    if (Bun.which(player.binary)) {
      detectedPlayer = player
      return player
    }
  }

  detectedPlayer = null
  throwPlayerNotFound()
}

export function resetDetectedPlayer(): void {
  detectedPlayer = undefined
  detectedFfplayMajorVersion = undefined
}

/** Minimal process handle for file-based players (afplay). */
export interface FilePlayerProcess {
  pid: number | undefined
  exited: Promise<number>
  kill: () => void
  pause: () => void
  resume: () => void
}

export function spawnAfplay(filePath: string, speed?: number): FilePlayerProcess {
  const args =
    typeof speed === 'number' && Number.isFinite(speed) && speed > 0
      ? [filePath, '-r', String(speed)]
      : [filePath]

  const proc = Bun.spawn(['afplay', ...args], { stdout: 'ignore', stderr: 'ignore' })

  return {
    pid: proc.pid,
    exited: proc.exited,
    kill: () => proc.kill(),
    pause: () => {
      try {
        process.kill(proc.pid!, 'SIGSTOP')
      } catch {
        /* already exited */
      }
    },
    resume: () => {
      try {
        process.kill(proc.pid!, 'SIGCONT')
      } catch {
        /* already exited */
      }
    },
  }
}
