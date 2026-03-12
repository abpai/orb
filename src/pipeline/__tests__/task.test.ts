import { afterEach, describe, expect, it, mock } from 'bun:test'

import { createFrame, type Frame } from '../frames'
import type { Transport } from '../transports/types'
import { DEFAULT_CONFIG } from '../../types'

let stopCalls = 0
let releaseWait: (() => void) | null = null

function createTransport(): Transport {
  return {
    onInbound: () => () => {},
    emitInbound: () => {},
    onOutbound: () => () => {},
    sendOutbound: () => {},
    dispose: () => {},
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
      createTTSProcessor: () =>
        async function* (upstream: AsyncIterable<Frame>) {
          for await (const frame of upstream) {
            yield frame
            if (frame.kind === 'agent-text-complete') {
              yield createFrame('tts-pending', {
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
})
