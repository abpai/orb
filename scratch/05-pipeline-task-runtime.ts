/**
 * scratch/05-pipeline-task-runtime.ts — Pipeline Orchestrator
 *
 * Shows the central runtime primitive:
 *   one task orchestrates processors, state transitions, and outbound transport.
 *
 * ENTRY: src/pipeline/task.ts:51 createPipelineTask()
 *
 * Run:
 *   bun run scratch/05-pipeline-task-runtime.ts
 */
import { mock } from 'bun:test'
import { createFrame, type Frame } from '../src/pipeline/frames'
import { createTerminalTextTransport } from '../src/pipeline/transports/terminal-text'
import type { OutboundFrame } from '../src/pipeline/transports/types'
import { DEFAULT_CONFIG } from '../src/types'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let stopCalls = 0
const pendingResolvers: Array<() => void> = []

mock.module('../src/pipeline/processors/agent', () => ({
  createAgentProcessor: () =>
    async function* (upstream: AsyncIterable<Frame>): AsyncGenerator<Frame> {
      for await (const frame of upstream) {
        if (frame.kind !== 'user-text') {
          yield frame
          continue
        }

        if (frame.text === 'speak-demo') {
          yield createFrame('agent-text-delta', { delta: 'voice ', accumulatedText: 'voice ' })
          yield createFrame('agent-text-complete', { text: 'speak-demo complete' })
          continue
        }

        if (frame.text === 'cancel-demo') {
          yield createFrame('agent-text-delta', { delta: 'cancel ', accumulatedText: 'cancel ' })
          yield createFrame('agent-text-complete', { text: 'cancel-demo complete' })
          continue
        }

        if (frame.text === 'slow-run') {
          yield createFrame('agent-text-delta', { delta: 'slow ', accumulatedText: 'slow ' })
          await sleep(80)
          yield createFrame('agent-text-complete', { text: 'slow-run complete' })
          continue
        }

        if (frame.text === 'fast-run') {
          yield createFrame('agent-text-delta', { delta: 'fast ', accumulatedText: 'fast ' })
          yield createFrame('agent-text-complete', { text: 'fast-run complete' })
        }
      }
    },
}))

mock.module('../src/pipeline/processors/tts', () => ({
  createTTSProcessor: (
    _appConfig: unknown,
    runControl?: { setCompletion(handle: { waitForCompletion(): Promise<void>; stop(): void } | null): void },
  ) =>
    async function* (upstream: AsyncIterable<Frame>): AsyncGenerator<Frame> {
      for await (const frame of upstream) {
        yield frame

        if (frame.kind !== 'agent-text-complete') continue

        if (frame.text === 'speak-demo complete') {
          yield createFrame('tts-speaking-start')
          runControl?.setCompletion({
            waitForCompletion: () =>
              new Promise<void>((resolve) => {
                pendingResolvers.push(resolve)
                setTimeout(resolve, 30)
              }),
            stop: () => {
              stopCalls += 1
              while (pendingResolvers.length > 0) {
                pendingResolvers.shift()?.()
              }
            },
          })
        }

        if (frame.text === 'cancel-demo complete') {
          yield createFrame('tts-speaking-start')
          runControl?.setCompletion({
            waitForCompletion: () =>
              new Promise<void>((resolve) => {
                pendingResolvers.push(resolve)
              }),
            stop: () => {
              stopCalls += 1
              while (pendingResolvers.length > 0) {
                pendingResolvers.shift()?.()
              }
            },
          })
        }
      }
    },
}))

const { createPipelineTask } = await import('../src/pipeline/task')

function createCapture() {
  const transport = createTerminalTextTransport()
  const outbound: OutboundFrame[] = []
  const states: string[] = []
  transport.onOutbound((frame) => outbound.push(frame))
  return { transport, outbound, states }
}

console.log('05 · Pipeline Orchestrator\n')
console.log('Primitive:')
console.log('  user-text frame -> processors -> outbound frames + task state\n')

console.log('Scenario 1: successful run with hidden completion handle\n')

{
  const capture = createCapture()
  const task = createPipelineTask({
    appConfig: DEFAULT_CONFIG,
    transport: capture.transport,
  })
  task.onStateChange((state) => capture.states.push(state))

  const result = await task.run('speak-demo', 'entry-1')

  console.log(`  states   → ${capture.states.join(' → ')}`)
  console.log(`  outbound → ${capture.outbound.map((frame) => frame.kind).join(', ')}`)
  console.log(`  result   → cancelled=${result.cancelled}, text=${JSON.stringify(result.text)}`)
  console.log(
    '  note     → the completion handle stays internal to PipelineTask and never appears in outbound frames',
  )
}

console.log('\nScenario 2: cancel stops active TTS once\n')

{
  stopCalls = 0
  const capture = createCapture()
  const task = createPipelineTask({
    appConfig: DEFAULT_CONFIG,
    transport: capture.transport,
  })
  task.onStateChange((state) => capture.states.push(state))

  const runPromise = task.run('cancel-demo', 'entry-2')
  await sleep(20)
  task.cancel()
  const result = await runPromise

  console.log(`  states     → ${capture.states.join(' → ')}`)
  console.log(`  outbound   → ${capture.outbound.map((frame) => frame.kind).join(', ')}`)
  console.log(`  stopCalls  → ${stopCalls}`)
  console.log(`  result     → cancelled=${result.cancelled}, text=${JSON.stringify(result.text)}`)
  console.log('  note       → cancel now stops the internal completion handle exactly once')
}

console.log('\nScenario 3: stale run drops late frames from the older run\n')

{
  const capture = createCapture()
  const task = createPipelineTask({
    appConfig: DEFAULT_CONFIG,
    transport: capture.transport,
  })

  const slowPromise = task.run('slow-run', 'entry-3')
  await sleep(20)
  const fastPromise = task.run('fast-run', 'entry-4')

  const slowResult = await slowPromise
  const fastResult = await fastPromise

  console.log(
    `  outbound deltas/completions → ${capture.outbound
      .map((frame) => {
        if (frame.kind === 'agent-text-delta') return `delta:${frame.delta.trim()}`
        if (frame.kind === 'agent-text-complete') return `complete:${frame.text}`
        return frame.kind
      })
      .join(', ')}`,
  )
  console.log(
    `  slow result               → cancelled=${slowResult.cancelled}, text=${JSON.stringify(slowResult.text)}`,
  )
  console.log(
    `  fast result               → cancelled=${fastResult.cancelled}, text=${JSON.stringify(fastResult.text)}`,
  )
  console.log(
    '  note                      → the slow run emitted an early delta, but its late completion was dropped after runCounter advanced',
  )
}

mock.restore()

console.log('\nTakeaway:')
console.log('  PipelineTask is the orchestrator.')
console.log('  It owns task state, stale-run invalidation, and the transport boundary.')
