import { afterEach, describe, expect, it, mock } from 'bun:test'

import { DEFAULT_CONFIG, TTSError } from '../../types'
import { createFrame, type Frame } from '../frames'
import { createTTSProcessor, type TTSCompletionHandle } from './tts'

async function collectFrames(source: AsyncIterable<Frame>): Promise<Frame[]> {
  const frames: Frame[] = []
  for await (const frame of source) {
    frames.push(frame)
  }
  return frames
}

async function* fromFrames(frames: Frame[]): AsyncIterable<Frame> {
  for (const frame of frames) {
    yield frame
  }
}

describe('createTTSProcessor', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })

  it('keeps pending streaming TTS work alive after the processor finishes', async () => {
    const deferred: { reject?: (error: Error) => void } = {}
    globalThis.fetch = mock(async () => {
      return await new Promise<Response>((_resolve, reject) => {
        deferred.reject = (error: Error) => reject(error)
      })
    }) as unknown as typeof globalThis.fetch

    let completionHandle: TTSCompletionHandle | null = null

    const processor = createTTSProcessor(
      {
        ...DEFAULT_CONFIG,
        ttsEnabled: true,
        ttsStreamingEnabled: true,
        ttsMode: 'serve',
        ttsServerUrl: 'http://localhost:8000',
      },
      {
        setCompletion(handle) {
          completionHandle = handle
        },
      },
    )

    const frames = await collectFrames(
      processor(
        fromFrames([
          createFrame('agent-text-delta', {
            delta: 'Hello world.',
            accumulatedText: 'Hello world.',
          }),
          createFrame('agent-text-complete', { text: 'Hello world.' }),
        ]),
      ),
    )

    expect(frames.map((frame) => frame.kind)).toContain('agent-text-delta')
    expect(frames.map((frame) => frame.kind)).toContain('agent-text-complete')
    expect(frames.map((frame) => frame.kind)).not.toContain('tts-pending')
    expect(completionHandle).not.toBeNull()

    if (!completionHandle) {
      throw new Error('Expected a completion handle')
    }

    const completion = (completionHandle as TTSCompletionHandle).waitForCompletion()
    const failFetch = deferred.reject
    expect(failFetch).not.toBeNull()
    if (!failFetch) {
      throw new Error('Expected the deferred fetch reject handle to be set')
    }
    failFetch(new Error('synthetic tts failure'))

    await expect(completion).rejects.toBeInstanceOf(TTSError)
  })

  it('drives batch (non-streaming) playback through the same controller handoff', async () => {
    const deferred: { reject?: (error: Error) => void } = {}
    const fetchedUrls: string[] = []
    globalThis.fetch = mock(async (input: unknown) => {
      fetchedUrls.push(String(input))
      return await new Promise<Response>((_resolve, reject) => {
        deferred.reject = (error: Error) => reject(error)
      })
    }) as unknown as typeof globalThis.fetch

    let completionHandle: TTSCompletionHandle | null = null

    const processor = createTTSProcessor(
      {
        ...DEFAULT_CONFIG,
        ttsEnabled: true,
        ttsStreamingEnabled: false,
        ttsMode: 'serve',
        ttsServerUrl: 'http://localhost:8000',
      },
      {
        setCompletion(handle) {
          completionHandle = handle
        },
      },
    )

    const frames = await collectFrames(
      processor(
        fromFrames([
          createFrame('agent-text-delta', {
            delta: 'Hello world.',
            accumulatedText: 'Hello world.',
          }),
          // In batch mode the delta is withheld; nothing is synthesized until
          // the complete text arrives.
          createFrame('agent-text-complete', { text: 'Hello world.' }),
        ]),
      ),
    )

    // Disabling streaming must keep serve-mode playback on the batch
    // /v1/speech endpoint, never the /tts/stream endpoint, so gateways without
    // streaming support keep working.
    expect(fetchedUrls.length).toBeGreaterThan(0)
    expect(fetchedUrls.some((url) => url.includes('/v1/speech'))).toBe(true)
    expect(fetchedUrls.some((url) => url.includes('/tts/stream'))).toBe(false)
    expect(frames.map((frame) => frame.kind)).toContain('agent-text-complete')
    expect(completionHandle).not.toBeNull()

    if (!completionHandle) {
      throw new Error('Expected a completion handle')
    }

    const completion = (completionHandle as TTSCompletionHandle).waitForCompletion()
    const failFetch = deferred.reject
    if (!failFetch) {
      throw new Error('Expected the deferred fetch reject handle to be set')
    }
    failFetch(new Error('synthetic tts failure'))

    await expect(completion).rejects.toBeInstanceOf(TTSError)
  })

  it('does not abort the agent turn when TTS setup is misconfigured', async () => {
    let completionHandle: TTSCompletionHandle | null = null

    // A malformed server URL makes the gateway client throw — this must surface
    // through the completion handle, not synchronously at controller
    // construction (which would abort the whole agent turn).
    const processor = createTTSProcessor(
      {
        ...DEFAULT_CONFIG,
        ttsEnabled: true,
        ttsStreamingEnabled: false,
        ttsMode: 'serve',
        ttsServerUrl: 'not-a-valid-url',
      },
      {
        setCompletion(handle) {
          completionHandle = handle
        },
      },
    )

    // The answer still flows through even though TTS can't start.
    const frames = await collectFrames(
      processor(fromFrames([createFrame('agent-text-complete', { text: 'Hello world.' })])),
    )

    expect(frames.map((frame) => frame.kind)).toContain('agent-text-complete')
    expect(completionHandle).not.toBeNull()

    if (!completionHandle) {
      throw new Error('Expected a completion handle')
    }

    // The misconfiguration is reported through the handle rather than thrown.
    await expect(
      (completionHandle as TTSCompletionHandle).waitForCompletion(),
    ).rejects.toBeInstanceOf(TTSError)
  })
})
