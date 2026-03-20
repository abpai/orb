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
})
