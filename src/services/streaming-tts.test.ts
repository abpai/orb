import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { AppConfig } from '../types'
import { DEFAULT_CONFIG } from '../types'
import { createStreamingSpeechController } from './streaming-tts'

const originalFetch = globalThis.fetch
const originalSpawn = Bun.spawn

afterEach(() => {
  globalThis.fetch = originalFetch
  Bun.spawn = originalSpawn
  mock.restore()
})

function installTTSMocks() {
  globalThis.fetch = mock(async () => {
    return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 })
  }) as unknown as typeof globalThis.fetch

  Bun.spawn = mock(() => {
    return {
      exited: Promise.resolve(0),
      kill: () => {},
    } as Bun.Subprocess
  }) as typeof Bun.spawn
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
})
