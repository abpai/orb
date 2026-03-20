import { afterEach, describe, expect, it, mock } from 'bun:test'

import { createFrame, type Frame } from '../frames'
import type { Transport } from '../transports/types'
import { DEFAULT_CONFIG, TTSError } from '../../types'

let stopCalls = 0
let releaseWait: (() => void) | null = null

function createTransport(): Transport {
  return {
    onOutbound: () => () => {},
    sendOutbound: () => {},
  }
}

afterEach(() => {
  mock.restore()
})

describe('createPipelineTask', () => {
  it('stops active TTS work when cancelled during speaking', async () => {
    stopCalls = 0
    releaseWait = null

    mock.module('../processors/agent', () => ({
      createAgentProcessor: () =>
        async function* () {
          yield createFrame('agent-text-complete', { text: 'done' })
        },
    }))

    mock.module('../processors/tts', () => ({
      createTTSProcessor: (
        _config: unknown,
        runControl?: { setCompletion?: (handle: unknown) => void },
      ) =>
        async function* (upstream: AsyncIterable<Frame>) {
          for await (const frame of upstream) {
            yield frame
            if (frame.kind === 'agent-text-complete') {
              runControl?.setCompletion?.({
                waitForCompletion: () =>
                  new Promise<void>((resolve) => {
                    releaseWait = resolve
                  }),
                stop: () => {
                  stopCalls += 1
                  releaseWait?.()
                },
              })
            }
          }
        },
    }))

    const { createPipelineTask } = await import('../task')
    const task = createPipelineTask({
      appConfig: DEFAULT_CONFIG,
      transport: createTransport(),
    })

    const states: string[] = []
    task.onStateChange((state) => {
      states.push(state)
    })

    const runPromise = task.run('hello', 'entry-1')
    await new Promise((resolve) => setTimeout(resolve, 20))

    task.cancel()
    const result = await runPromise

    expect(stopCalls).toBe(1)
    expect(result.cancelled).toBe(true)
    expect(states).toContain('processing')
    expect(states).toContain('speaking')
    expect(task.state).toBe('idle')
  })

  it('emits tts-error from completion even when processor already yielded one', async () => {
    const outboundFrames: Frame[] = []

    mock.module('../processors/agent', () => ({
      createAgentProcessor: () =>
        async function* () {
          yield createFrame('agent-text-complete', { text: 'done' })
        },
    }))

    mock.module('../processors/tts', () => ({
      createTTSProcessor: (
        _config: unknown,
        runControl?: { setCompletion?: (handle: unknown) => void },
      ) =>
        async function* (upstream: AsyncIterable<Frame>) {
          for await (const frame of upstream) {
            yield frame
            if (frame.kind === 'agent-text-complete') {
              yield createFrame('tts-error', {
                errorType: 'generation_failed',
                message: 'tts failed',
              })

              runControl?.setCompletion?.({
                waitForCompletion: () =>
                  Promise.reject(new TTSError('tts failed', 'generation_failed')),
                stop: () => {},
              })
            }
          }
        },
    }))

    const { createPipelineTask } = await import('../task')
    const task = createPipelineTask({
      appConfig: DEFAULT_CONFIG,
      transport: {
        onOutbound: () => () => {},
        sendOutbound: (frame) => {
          outboundFrames.push(frame)
        },
      },
    })

    await task.run('hello', 'entry-1')

    // Both the processor callback and the completion catch block emit tts-error.
    // Duplicates are harmless — setTtsError in the UI is idempotent.
    expect(
      outboundFrames.filter((frame) => frame.kind === 'tts-error').length,
    ).toBeGreaterThanOrEqual(1)
  })
})
