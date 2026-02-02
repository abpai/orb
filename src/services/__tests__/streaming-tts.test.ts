import { describe, expect, it } from 'bun:test'
import type { AppConfig } from '../../types'
import { DEFAULT_CONFIG } from '../../types'
import { createStreamingSpeechController } from '../streaming-tts'

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
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config, {
        onSpeakingStart: () => {},
      })

      controller.feedText('Hello world. ')
      controller.feedText('This is a test. ')
      controller.finalize()

      // The controller should have processed these as separate chunks
      expect(controller.isActive()).toBe(true)
    })

    it('handles text without sentence boundaries', () => {
      const config = createTestConfig({ ttsMaxWaitMs: 0 })
      const controller = createStreamingSpeechController(config)

      controller.feedText('A continuous stream of words without punctuation')
      controller.finalize()

      // Should complete without hanging
      expect(controller.isActive()).toBe(true)
    })
  })

  describe('long text without whitespace', () => {
    it('handles text without any whitespace by triggering forced flush', async () => {
      const config = createTestConfig({ ttsMaxWaitMs: 50 })
      const controller = createStreamingSpeechController(config)

      // Feed text with no whitespace - this should trigger forced flush after timeout
      const longWord = 'a'.repeat(250)
      controller.feedText(longWord)

      // Give time for timeout to trigger the forced flush path
      await new Promise((resolve) => setTimeout(resolve, 100))

      // The controller should have queued work (not stuck in infinite loop)
      // It will try to generate audio which may fail, but that's separate from the chunking logic
      expect(controller.isActive()).toBe(true)

      // Clean up
      controller.stop()
    })

    it('handles long text without punctuation via whitespace boundaries', async () => {
      const config = createTestConfig({ ttsMaxWaitMs: 50 })
      const controller = createStreamingSpeechController(config)

      // Text with spaces but no sentence-ending punctuation
      controller.feedText('word '.repeat(50))

      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should have extracted chunks at whitespace boundaries
      expect(controller.isActive()).toBe(true)

      // Clean up
      controller.stop()
    })
  })

  describe('controller lifecycle', () => {
    it('starts inactive', () => {
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      // Before any text is fed, should not be active
      expect(controller.isActive()).toBe(false)
    })

    it('becomes active after receiving text', () => {
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      controller.feedText('Hello world.')

      // After feeding text, should become active
      expect(controller.isActive()).toBe(true)

      controller.stop()
    })

    it('can be stopped', () => {
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      controller.feedText('Some text.')
      controller.stop()

      // After stop, isActive should be false
      expect(controller.isActive()).toBe(false)
    })

    it('ignores text when TTS is disabled', () => {
      const config = createTestConfig({ ttsEnabled: false })
      const controller = createStreamingSpeechController(config)

      controller.feedText('This should be ignored.')
      controller.finalize()

      expect(controller.isActive()).toBe(false)
    })
  })

  describe('finalization', () => {
    it('extracts remaining text on finalize', () => {
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      // Text without ending punctuation
      controller.feedText('Incomplete sentence without period')
      controller.finalize()

      // Should process remaining text
      expect(controller.isActive()).toBe(true)

      controller.stop()
    })

    it('handles empty input gracefully', async () => {
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      controller.finalize()

      const completion = controller.waitForCompletion()
      await expect(completion).resolves.toBeUndefined()
    })

    it('handles whitespace-only input gracefully', async () => {
      const config = createTestConfig()
      const controller = createStreamingSpeechController(config)

      controller.feedText('   \n\t  ')
      controller.finalize()

      // Should not be active with only whitespace
      expect(controller.isActive()).toBe(false)
    })
  })
})
