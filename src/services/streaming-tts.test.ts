import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { AppConfig } from '../types'
import { DEFAULT_CONFIG } from '../types'
import { createStreamingSpeechController } from './streaming-tts'
import { resetDetectedPlayer } from './tts'

const originalFetch = globalThis.fetch
const originalSpawn = Bun.spawn
const originalWhich = Bun.which

afterEach(() => {
  globalThis.fetch = originalFetch
  Bun.spawn = originalSpawn
  Bun.which = originalWhich
  resetDetectedPlayer()
  mock.restore()
})

function installTTSMocks() {
  globalThis.fetch = mock(async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })
    return new Response(stream, { status: 200 })
  }) as unknown as typeof globalThis.fetch

  Bun.which = mock(() => '/usr/local/bin/mpv') as unknown as typeof Bun.which

  Bun.spawn = mock(() => {
    return {
      stdin: { write() {}, end() {} },
      exited: Promise.resolve(0),
      kill() {},
    } as unknown as Bun.Subprocess
  }) as unknown as typeof Bun.spawn
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor: timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function emptyStreamResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

function createTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ttsEnabled: true,
    ttsStreamingEnabled: true,
    ttsBufferSentences: 1,
    ttsMinChunkLength: 10,
    ttsMaxWaitMs: 100,
    ttsGraceWindowMs: 0,
    ttsClauseBoundaries: false,
    ...overrides,
  }
}

describe('createStreamingSpeechController', () => {
  describe('chunk extraction', () => {
    it('extracts chunks at sentence boundaries', () => {
      installTTSMocks()
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config, {
        onSpeakingStart: () => {},
      })

      controller.feedText('Hello world. ')
      controller.feedText('This is a test. ')
      controller.finalize()

      expect(controller.isActive()).toBe(true)
      controller.stop()
    })

    it('handles text without sentence boundaries', () => {
      installTTSMocks()
      const config = createTestConfig({ ttsMaxWaitMs: 0 })
      const controller = createStreamingSpeechController(config)

      controller.feedText('A continuous stream of words without punctuation')
      controller.finalize()

      expect(controller.isActive()).toBe(true)
      controller.stop()
    })

    it('speaks buffered sentence groups as a single audio request', async () => {
      const requests: string[] = []
      globalThis.fetch = mock(
        async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
          const body = typeof init?.body === 'string' ? init.body : ''
          requests.push(body ? (JSON.parse(body).text as string) : '')
          return emptyStreamResponse()
        },
      ) as unknown as typeof globalThis.fetch

      Bun.which = mock(() => '/usr/local/bin/mpv') as unknown as typeof Bun.which
      Bun.spawn = mock(
        () =>
          ({
            stdin: { write() {}, end() {} },
            exited: Promise.resolve(0),
            kill() {},
          }) as unknown as Bun.Subprocess,
      ) as unknown as typeof Bun.spawn

      const controller = createStreamingSpeechController(
        createTestConfig({
          ttsBufferSentences: 2,
          ttsMinChunkLength: 0,
          ttsMaxWaitMs: 0,
        }),
      )

      controller.feedText('First. Second. Third. Fourth.')
      controller.finalize()
      await controller.waitForCompletion()

      expect(requests).toEqual(['First. Second.', 'Third. Fourth.'])
    })
  })

  describe('buffer compaction', () => {
    // Compaction drops the settled buffer prefix between sentences. Feeding the
    // same text as many tiny deltas exercises compaction repeatedly, while one
    // whole feed compacts only at the end — so identical spoken output proves
    // compaction does not change chunk boundaries, ordering, or content.
    async function spokenChunks(feeds: string[]): Promise<string[]> {
      const requests: string[] = []
      globalThis.fetch = mock(
        async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
          const body = typeof init?.body === 'string' ? init.body : ''
          requests.push(body ? (JSON.parse(body).text as string) : '')
          return emptyStreamResponse()
        },
      ) as unknown as typeof globalThis.fetch
      Bun.which = mock(() => '/usr/local/bin/mpv') as unknown as typeof Bun.which
      Bun.spawn = mock(
        () =>
          ({
            stdin: { write() {}, end() {} },
            exited: Promise.resolve(0),
            kill() {},
          }) as unknown as Bun.Subprocess,
      ) as unknown as typeof Bun.spawn

      const controller = createStreamingSpeechController(
        createTestConfig({
          ttsBufferSentences: 1,
          ttsMinChunkLength: 0,
          ttsMaxWaitMs: 0,
          ttsClauseBoundaries: false,
        }),
      )
      for (const feed of feeds) controller.feedText(feed)
      controller.finalize()
      await controller.waitForCompletion()
      // Trim each chunk: compaction may drop a cosmetic leading space that TTS
      // renders identically; boundaries/ordering/content must still match.
      return requests.map((request) => request.trim())
    }

    function toDeltas(text: string, size: number): string[] {
      const deltas: string[] = []
      for (let i = 0; i < text.length; i += size) deltas.push(text.slice(i, i + size))
      return deltas
    }

    it('yields identical chunks for prose fed whole vs. as tiny deltas', async () => {
      const text =
        'First sentence here. Second one follows! Is this the third? ' +
        'A fourth sentence to be sure. And a fifth one closes it out.'

      const whole = await spokenChunks([text])
      const streamed = await spokenChunks(toDeltas(text, 2))

      expect(whole.length).toBeGreaterThan(1)
      expect(streamed).toEqual(whole)
    })

    it('keeps code fences and inline code intact across compaction', async () => {
      const text =
        'Here is `inline code` in a sentence. Now a block:\n' +
        '```\nconst x = 1\nconst y = 2\n```\n' +
        'The block is done. One more sentence after it.'

      const whole = await spokenChunks([text])
      const streamed = await spokenChunks(toDeltas(text, 1))

      expect(streamed).toEqual(whole)
    })
  })

  describe('long text without whitespace', () => {
    it('handles text without any whitespace by triggering forced flush', async () => {
      installTTSMocks()
      const config = createTestConfig({ ttsMaxWaitMs: 50 })
      const controller = createStreamingSpeechController(config)

      controller.feedText('a'.repeat(250))

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(controller.isActive()).toBe(true)
      controller.stop()
    })

    it('handles long text without punctuation via whitespace boundaries', async () => {
      installTTSMocks()
      const config = createTestConfig({ ttsMaxWaitMs: 50 })
      const controller = createStreamingSpeechController(config)

      controller.feedText('word '.repeat(50))

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(controller.isActive()).toBe(true)
      controller.stop()
    })
  })

  describe('controller lifecycle', () => {
    it('starts inactive', () => {
      installTTSMocks()
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      expect(controller.isActive()).toBe(false)
    })

    it('becomes active after receiving text', () => {
      installTTSMocks()
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      controller.feedText('Hello world.')

      expect(controller.isActive()).toBe(true)
      controller.stop()
    })

    it('can be stopped', () => {
      installTTSMocks()
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      controller.feedText('Some text.')
      controller.stop()

      expect(controller.isActive()).toBe(false)
    })

    it('ignores text when TTS is disabled', () => {
      installTTSMocks()
      const config = createTestConfig({ ttsEnabled: false })
      const controller = createStreamingSpeechController(config)

      controller.feedText('This should be ignored.')
      controller.finalize()

      expect(controller.isActive()).toBe(false)
    })
  })

  describe('finalization', () => {
    it('extracts remaining text on finalize', () => {
      installTTSMocks()
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      controller.feedText('Incomplete sentence without period')
      controller.finalize()

      expect(controller.isActive()).toBe(true)
      controller.stop()
    })

    it('handles empty input gracefully', async () => {
      installTTSMocks()
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      controller.finalize()

      const completion = controller.waitForCompletion()
      await expect(completion).resolves.toBeUndefined()
    })

    it('handles whitespace-only input gracefully', async () => {
      installTTSMocks()
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      controller.feedText('   \n\t  ')
      controller.finalize()

      expect(controller.isActive()).toBe(false)
    })
  })

  describe('prefetch race', () => {
    it('reuses an in-flight prefetch for the matching next chunk', async () => {
      const signals: AbortSignal[] = []
      const deferreds: Array<{
        resolve: (r: Response) => void
        text: string
      }> = []

      globalThis.fetch = mock(
        (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
          if (init?.signal) signals.push(init.signal)
          const body = typeof init?.body === 'string' ? init.body : ''
          const text = body ? (JSON.parse(body).text as string) : ''
          const { promise, resolve } = Promise.withResolvers<Response>()
          deferreds.push({ resolve, text })
          return promise
        },
      ) as unknown as typeof globalThis.fetch

      Bun.which = mock(() => '/usr/local/bin/mpv') as unknown as typeof Bun.which

      // Spawned "player" drains its stdin stream immediately.
      Bun.spawn = mock(
        () =>
          ({
            stdin: { write() {}, end() {} },
            exited: Promise.resolve(0),
            kill() {},
          }) as unknown as Bun.Subprocess,
      ) as unknown as typeof Bun.spawn

      const config = createTestConfig({
        ttsMinChunkLength: 0,
        ttsMaxWaitMs: 0,
        ttsBufferSentences: 1,
      })
      const controller = createStreamingSpeechController(config)

      controller.feedText('Alpha. ')
      controller.feedText('Beta. ')
      controller.feedText('Gamma. ')
      controller.finalize()

      await waitFor(() => deferreds.length >= 1)
      expect(deferreds[0]!.text).toContain('Alpha')
      deferreds[0]!.resolve(emptyStreamResponse())

      await waitFor(() => deferreds.length >= 2)
      expect(deferreds[1]!.text).toContain('Beta')
      await new Promise((resolve) => setTimeout(resolve, 25))

      const betaRequestsBeforeResolve = deferreds.filter(({ text }) => text.includes('Beta'))
      expect(betaRequestsBeforeResolve).toHaveLength(1)
      expect(signals[1]!.aborted).toBe(false)

      deferreds[1]!.resolve(emptyStreamResponse())
      await waitFor(() => deferreds.length >= 3)
      expect(deferreds[2]!.text).toContain('Gamma')
      deferreds[2]!.resolve(emptyStreamResponse())

      await controller.waitForCompletion()

      controller.stop()
    })
  })
})
