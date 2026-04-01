import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_CONFIG } from '../types'

async function importGenerateAudio() {
  mock.restore()
  const module = await import('./tts')
  return module.generateAudio
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

  it('sends tts-gateway form fields in serve mode', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-tts-'))
    const outputPath = join(tempDir, 'speech.wav')
    let requestBody: globalThis.FormData | undefined
    const generateAudio = await importGenerateAudio()

    globalThis.fetch = mock(
      async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
        requestBody = (init?.body as globalThis.FormData) ?? null
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
    expect(requestBodies[0]?.get('voice_url')).toBeNull()
    expect(requestBodies[1]?.get('voice_url')).toBeNull()

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
