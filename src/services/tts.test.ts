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

  afterEach(() => {
    mock.restore()
    globalThis.fetch = originalFetch
  })

  it('sends both voice and voice_url fields in serve mode', async () => {
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
    expect(requestBody!.get('voice_url')).toBe('alba')
    expect(requestBody!.get('speed')).toBe('1.5')

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
    expect(requestBodies[0]?.get('voice_url')).toBe('alba')
    expect(requestBodies[1]?.get('voice')).toBeNull()
    expect(requestBodies[1]?.get('voice_url')).toBeNull()

    await rm(tempDir, { recursive: true, force: true })
  })
})
