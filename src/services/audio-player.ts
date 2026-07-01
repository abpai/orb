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
    write: (data: Uint8Array) => void
    end: () => void
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

let detectedFfplayMajorVersion: number | null | undefined = undefined

function detectFfplayMajorVersion(): number | null {
  if (detectedFfplayMajorVersion !== undefined) return detectedFfplayMajorVersion

  try {
    const result = Bun.spawnSync(['ffplay', '-version'], {
      stdout: 'pipe',
      stderr: 'ignore',
    })
    const text = new TextDecoder().decode(result.stdout)
    const major = Number.parseInt(text.match(/ffplay version\s+(\d+)/)?.[1] ?? '', 10)
    detectedFfplayMajorVersion = Number.isFinite(major) ? major : null
  } catch {
    detectedFfplayMajorVersion = null
  }

  return detectedFfplayMajorVersion
}

export function buildFfplayRawPcmArgs(
  format: Extract<StreamAudioFormat, { kind: 'raw-pcm' }>,
  ffplayMajorVersion: number | null = detectFfplayMajorVersion(),
): string[] {
  if (ffplayMajorVersion !== null && ffplayMajorVersion < 5) {
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
  const proc = spawnChildProcess('ffplay', args, {
    stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
  })
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

  return {
    writer: {
      write(data: Uint8Array) {
        audioWriter.write(data)
      },
      end() {
        audioWriter.end()
      },
    },
    exited: new Promise<number>((resolve, reject) => {
      proc.once('error', reject)
      proc.once('exit', (code, signal) => resolve(normalizeExitCode(code, signal)))
    }),
    kill() {
      proc.kill()
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
    writer: proc.stdin,
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
