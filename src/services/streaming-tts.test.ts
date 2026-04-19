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
    // Regression: when the prefetch for sentence N+1 had not yet resolved by
    // the time sentence N finished playing, streamOrFallback would fall back
    // to a fresh fetch — but leave the in-flight prefetch dangling. The stale
    // prefetch would later populate `prefetchedStream`, and sentence N+2
    // would play it instead of its own audio, sounding like "last sentence
    // repeats." The fix cancels the in-flight prefetch before starting the
    // fresh fetch; this test pins that behavior.
    it('aborts an in-flight prefetch when it has to fall back to a fresh fetch', async () => {
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

      // Wait for Alpha's fetch to fire.
      await waitFor(() => deferreds.length >= 1)
      expect(deferreds[0]!.text).toContain('Alpha')
      // Resolve Alpha with an empty stream so its playback completes quickly.
      // Alpha's streamOrFallback will schedule a prefetch for Beta, then
      // session.done resolves; the controller recurses, sees Beta's prefetch
      // has not yet resolved, and must start a fresh fetch for Beta. The fix
      // aborts the dangling prefetch along the way.
      deferreds[0]!.resolve(emptyStreamResponse())

      await waitFor(() => deferreds.length >= 3)

      // deferreds[1] is Beta's prefetch; deferreds[2] is Beta's fresh fetch.
      expect(deferreds[1]!.text).toContain('Beta')
      expect(deferreds[2]!.text).toContain('Beta')
      expect(signals[1]!.aborted).toBe(true)

      controller.stop()
    })
  })
})
