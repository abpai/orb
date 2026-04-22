import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_CONFIG, TTSError } from '../types'

async function importModule() {
  mock.restore()
  return await import('./tts')
}

async function importGenerateAudio() {
  const module = await importModule()
  return module.generateAudio
}

async function resetAudioState() {
  const { stopSpeaking, resetDetectedPlayer } = await import('./tts')
  stopSpeaking()
  resetDetectedPlayer()
}

// Yields one event-loop tick so any pending microtasks settle. Lets us assert
// "spawn has not been called" without racing a wall-clock timeout.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('generateAudio', () => {
  const originalFetch = globalThis.fetch
  const originalSpawn = Bun.spawn
  const originalPlatform = process.platform

  afterEach(() => {
    mock.restore()
    globalThis.fetch = originalFetch
    Bun.spawn = originalSpawn
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('sends form data with text and voice in serve mode', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-tts-'))
    const outputPath = join(tempDir, 'speech.wav')
    let requestBody: globalThis.FormData | undefined
    const generateAudio = await importGenerateAudio()

    globalThis.fetch = mock(
      async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
        requestBody = init?.body as globalThis.FormData
        return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 })
      },
    ) as unknown as typeof globalThis.fetch

    await generateAudio(
      'hello world',
      {
        ...DEFAULT_CONFIG,
        ttsMode: 'serve',
        ttsServerUrl: 'http://localhost:8000',
        ttsVoice: 'alba',
      },
      outputPath,
    )

    expect(requestBody).toBeDefined()
    expect(requestBody!.get('text')).toBe('hello world')
    expect(requestBody!.get('voice')).toBe('alba')
    expect(requestBody!.get('voice_url')).toBeNull()
    expect(requestBody!.get('speed')).toBeNull()

    await rm(tempDir, { recursive: true, force: true })
  })

  it('retries without an explicit voice when the server rejects the requested voice', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-tts-'))
    const outputPath = join(tempDir, 'speech.wav')
    const requestBodies: globalThis.FormData[] = []
    let requestCount = 0
    const generateAudio = await importGenerateAudio()

    globalThis.fetch = mock(
      async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
        requestBodies.push((init?.body as globalThis.FormData) ?? new globalThis.FormData())
        requestCount += 1

        if (requestCount === 1) {
          return new Response('bad voice', { status: 502 })
        }

        return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 })
      },
    ) as unknown as typeof globalThis.fetch

    await generateAudio(
      'hello world',
      {
        ...DEFAULT_CONFIG,
        ttsMode: 'serve',
        ttsServerUrl: 'http://localhost:8000',
        ttsVoice: 'alba',
      },
      outputPath,
    )

    expect(requestBodies).toHaveLength(2)
    expect(requestBodies[0]?.get('voice')).toBe('alba')
    expect(requestBodies[1]?.get('voice')).toBeNull()

    await rm(tempDir, { recursive: true, force: true })
  })

  it('uses the documented default server URL when none is configured', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-tts-'))
    const outputPath = join(tempDir, 'speech.wav')
    let requestedUrl: string | undefined
    const generateAudio = await importGenerateAudio()

    globalThis.fetch = mock(async (input: string | globalThis.URL | Request) => {
      requestedUrl = String(input)
      return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 })
    }) as unknown as typeof globalThis.fetch

    await generateAudio(
      'hello world',
      { ...DEFAULT_CONFIG, ttsMode: 'serve', ttsServerUrl: undefined },
      outputPath,
    )

    expect(requestedUrl).toBe('http://localhost:8000/v1/speech')

    await rm(tempDir, { recursive: true, force: true })
  })

  it('uses macOS say in generate mode', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-tts-'))
    const outputPath = join(tempDir, 'speech.aiff')
    const spawnCalls: string[][] = []
    const generateAudio = await importGenerateAudio()

    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Bun.spawn = mock((cmd: string[]) => {
      spawnCalls.push(cmd)
      return { exited: Promise.resolve(0) } as Bun.Subprocess
    }) as unknown as typeof Bun.spawn

    await generateAudio(
      'hello world',
      {
        ...DEFAULT_CONFIG,
        ttsMode: 'generate',
        ttsVoice: 'marius',
        ttsSpeed: 2,
      },
      outputPath,
    )

    expect(spawnCalls).toEqual([
      ['say', '-o', outputPath, '-v', 'Daniel', '-r', '350', 'hello world'],
    ])

    await rm(tempDir, { recursive: true, force: true })
  })

  it('falls back to the default say voice when the mapped voice fails', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-tts-'))
    const outputPath = join(tempDir, 'speech.aiff')
    const spawnCalls: string[][] = []
    let callCount = 0
    const generateAudio = await importGenerateAudio()

    Object.defineProperty(process, 'platform', { value: 'darwin' })
    Bun.spawn = mock((cmd: string[]) => {
      spawnCalls.push(cmd)
      callCount += 1
      return { exited: Promise.resolve(callCount === 1 ? 1 : 0) } as Bun.Subprocess
    }) as unknown as typeof Bun.spawn

    await generateAudio(
      'hello world',
      {
        ...DEFAULT_CONFIG,
        ttsMode: 'generate',
        ttsVoice: 'jean',
      },
      outputPath,
    )

    expect(spawnCalls).toEqual([
      ['say', '-o', outputPath, '-v', 'Eddy (English (US))', '-r', '263', 'hello world'],
      ['say', '-o', outputPath, '-r', '263', 'hello world'],
    ])

    await rm(tempDir, { recursive: true, force: true })
  })

  it('fails clearly when generate mode is used outside macOS', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-tts-'))
    const outputPath = join(tempDir, 'speech.aiff')
    const generateAudio = await importGenerateAudio()

    Object.defineProperty(process, 'platform', { value: 'linux' })

    await expect(
      generateAudio(
        'hello world',
        {
          ...DEFAULT_CONFIG,
          ttsMode: 'generate',
        },
        outputPath,
      ),
    ).rejects.toMatchObject({
      type: 'command_not_found',
      message:
        'Generate mode requires macOS say. Use serve mode with tts-gateway on this platform.',
    })

    await rm(tempDir, { recursive: true, force: true })
  })
})

describe('detectPlayer', () => {
  const originalWhich = Bun.which

  afterEach(async () => {
    mock.restore()
    Bun.which = originalWhich
    await resetAudioState()
  })

  it('returns mpv config when mpv is available', async () => {
    const { detectPlayer, resetDetectedPlayer } = await importModule()
    resetDetectedPlayer()

    Bun.which = mock((binary: string) => {
      return binary === 'mpv' ? '/usr/local/bin/mpv' : null
    }) as unknown as typeof Bun.which

    const player = detectPlayer()
    expect(player.binary).toBe('mpv')
  })

  it('falls back to ffplay when mpv is not available', async () => {
    const { detectPlayer, resetDetectedPlayer } = await importModule()
    resetDetectedPlayer()

    Bun.which = mock((binary: string) => {
      return binary === 'ffplay' ? '/usr/local/bin/ffplay' : null
    }) as unknown as typeof Bun.which

    const player = detectPlayer()
    expect(player.binary).toBe('ffplay')
  })

  it('throws player_not_found when neither is available', async () => {
    const { detectPlayer, resetDetectedPlayer } = await importModule()
    resetDetectedPlayer()

    Bun.which = mock(() => null) as unknown as typeof Bun.which

    try {
      detectPlayer()
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TTSError)
      expect((err as TTSError).type).toBe('player_not_found')
    }
  })

  it('caches the result across calls', async () => {
    const { detectPlayer, resetDetectedPlayer } = await importModule()
    resetDetectedPlayer()

    let whichCount = 0
    Bun.which = mock(() => {
      whichCount++
      return '/usr/local/bin/mpv'
    }) as unknown as typeof Bun.which

    detectPlayer()
    detectPlayer()

    expect(whichCount).toBe(1)
  })
})

describe('playAudio', () => {
  const originalSpawn = Bun.spawn

  afterEach(async () => {
    mock.restore()
    Bun.spawn = originalSpawn
    await resetAudioState()
  })

  it('waits for resume before starting playback when paused first', async () => {
    const { pauseSpeaking, playAudio, resumeSpeaking } = await importModule()
    const spawnCalls: string[][] = []

    Bun.spawn = mock((cmd: string[]) => {
      spawnCalls.push(cmd)
      return {
        exited: Promise.resolve(0),
        kill() {},
      } as unknown as Bun.Subprocess
    }) as unknown as typeof Bun.spawn

    pauseSpeaking()
    const playPromise = playAudio('/tmp/orb-test.aiff', 1)

    await flushMicrotasks()
    expect(spawnCalls).toHaveLength(0)

    resumeSpeaking()
    await playPromise

    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]).toEqual(['afplay', '/tmp/orb-test.aiff', '-r', '1'])
  })
})

describe('createStreamSession', () => {
  const originalSpawn = Bun.spawn
  const originalWhich = Bun.which

  afterEach(async () => {
    mock.restore()
    Bun.spawn = originalSpawn
    Bun.which = originalWhich
    await resetAudioState()
  })

  function mockPlayerAvailable(player: 'mpv' | 'ffplay') {
    Bun.which = mock((binary: string) => {
      return binary === player ? `/usr/local/bin/${player}` : null
    }) as unknown as typeof Bun.which
  }

  it('pipes audio stream chunks to player stdin', async () => {
    const { createStreamSession, resetDetectedPlayer } = await importModule()
    resetDetectedPlayer()
    mockPlayerAvailable('mpv')

    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]
    const written: Uint8Array[] = []
    let stdinEnded = false
    let resolveExited: (code: number) => void

    Bun.spawn = mock(() => {
      return {
        stdin: {
          write(data: Uint8Array) {
            written.push(new Uint8Array(data))
          },
          end() {
            stdinEnded = true
          },
        },
        exited: new Promise<number>((resolve) => {
          resolveExited = resolve
        }),
        kill() {},
      } as unknown as Bun.Subprocess
    }) as unknown as typeof Bun.spawn

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })

    const session = createStreamSession(stream, 1)
    setTimeout(() => resolveExited!(0), 10)
    await session.done

    expect(written).toHaveLength(2)
    expect(written[0]).toEqual(new Uint8Array([1, 2, 3]))
    expect(written[1]).toEqual(new Uint8Array([4, 5, 6]))
    expect(stdinEnded).toBe(true)
  })

  it('rejects on non-zero player exit', async () => {
    const { createStreamSession, resetDetectedPlayer } = await importModule()
    resetDetectedPlayer()
    mockPlayerAvailable('mpv')

    Bun.spawn = mock(() => {
      return {
        stdin: { write() {}, end() {} },
        exited: Promise.resolve(1),
        kill() {},
      } as unknown as Bun.Subprocess
    }) as unknown as typeof Bun.spawn

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })

    const session = createStreamSession(stream, 1)

    try {
      await session.done
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TTSError)
      expect((err as TTSError).type).toBe('audio_playback')
    }
  })

  it('ignores reader releaseLock failures during cleanup', async () => {
    const { createStreamSession, resetDetectedPlayer } = await importModule()
    resetDetectedPlayer()
    mockPlayerAvailable('mpv')

    let stdinEnded = false

    Bun.spawn = mock(() => {
      return {
        stdin: {
          write() {},
          end() {
            stdinEnded = true
          },
        },
        exited: Promise.resolve(0),
        kill() {},
      } as unknown as Bun.Subprocess
    }) as unknown as typeof Bun.spawn

    const stream = {
      getReader() {
        return {
          async read() {
            return { done: true, value: undefined }
          },
          cancel() {
            return Promise.resolve()
          },
          releaseLock() {
            throw new TypeError('undefined is not a function')
          },
        }
      },
    } as unknown as ReadableStream<Uint8Array>

    const session = createStreamSession(stream, 1)
    await expect(session.done).resolves.toBeUndefined()
    expect(stdinEnded).toBe(true)
  })

  it('kill() terminates without throwing', async () => {
    const { createStreamSession, resetDetectedPlayer } = await importModule()
    resetDetectedPlayer()
    mockPlayerAvailable('mpv')

    let killed = false
    let resolveExited: (code: number) => void

    Bun.spawn = mock(() => {
      return {
        stdin: { write() {}, end() {} },
        exited: new Promise<number>((resolve) => {
          resolveExited = resolve
        }),
        kill() {
          killed = true
          resolveExited!(9)
        },
      } as unknown as Bun.Subprocess
    }) as unknown as typeof Bun.spawn

    const stream = new ReadableStream<Uint8Array>({
      start() {},
    })

    const session = createStreamSession(stream, 1.5)

    await new Promise((r) => setTimeout(r, 20))
    session.kill()

    await session.done
    expect(killed).toBe(true)
    expect(session.wasKilled).toBe(true)
  })

  it('waits for resume before starting the player when paused first', async () => {
    const { createStreamSession, pauseSpeaking, resetDetectedPlayer, resumeSpeaking } =
      await importModule()
    resetDetectedPlayer()
    mockPlayerAvailable('mpv')

    const spawnCalls: string[][] = []
    Bun.spawn = mock((cmd: string[]) => {
      spawnCalls.push(cmd)
      return {
        stdin: { write() {}, end() {} },
        exited: Promise.resolve(0),
        kill() {},
      } as unknown as Bun.Subprocess
    }) as unknown as typeof Bun.spawn

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })

    pauseSpeaking()
    const session = createStreamSession(stream, 1)

    await flushMicrotasks()
    expect(spawnCalls).toHaveLength(0)

    resumeSpeaking()
    await session.done

    expect(spawnCalls).toHaveLength(1)
  })

  it('passes speed to player args', async () => {
    const { createStreamSession, resetDetectedPlayer } = await importModule()
    resetDetectedPlayer()
    mockPlayerAvailable('mpv')

    let spawnedCmd: string[] = []

    Bun.spawn = mock((cmd: string[]) => {
      spawnedCmd = cmd
      return {
        stdin: { write() {}, end() {} },
        exited: Promise.resolve(0),
        kill() {},
      } as unknown as Bun.Subprocess
    }) as unknown as typeof Bun.spawn

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })

    const session = createStreamSession(stream, 1.5)
    await session.done

    expect(spawnedCmd).toContain('--speed=1.5')
  })

  it('uses ffplay control stdin for pause and resume', async () => {
    const controlWrites: string[] = []
    const audioWrites: Uint8Array[] = []
    const spawnCalls: string[][] = []
    const exitControl: {
      resolve: ((code: number | null, signal: NodeJS.Signals | null) => void) | null
    } = { resolve: null }

    mock.module('node:child_process', () => ({
      spawn: mock((_binary: string, args: string[]) => {
        spawnCalls.push(args)
        const exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = []

        return {
          stdin: {
            write(data: string) {
              controlWrites.push(data)
            },
          },
          stdio: [
            null,
            null,
            null,
            {
              write(data: Uint8Array) {
                audioWrites.push(new Uint8Array(data))
              },
              end() {
                exitControl.resolve = (code: number | null, signal: NodeJS.Signals | null) => {
                  for (const handler of exitHandlers) handler(code, signal)
                }
              },
            },
          ],
          once(event: string, handler: (...args: unknown[]) => void) {
            if (event === 'exit') {
              exitHandlers.push(
                handler as (code: number | null, signal: NodeJS.Signals | null) => void,
              )
            }
            return this
          },
          kill() {},
          pid: 123,
        }
      }),
    }))

    const { createStreamSession, resetDetectedPlayer } = await import(
      `./tts?ffplay-test=${Date.now()}-${Math.random()}`
    )
    resetDetectedPlayer()
    mockPlayerAvailable('ffplay')

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })

    const session = createStreamSession(stream, 1)
    await flushMicrotasks()

    session.pause()
    session.resume()
    if (exitControl.resolve) {
      exitControl.resolve(0, null)
    }
    await session.done

    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]).toContain('pipe:3')
    expect(controlWrites).toEqual(['p', 'p'])
    expect(audioWrites).toEqual([new Uint8Array([1, 2, 3])])
  })
})
