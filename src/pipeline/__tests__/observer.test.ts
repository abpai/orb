import { describe, expect, it, beforeEach } from 'bun:test'
import { createFrame, resetFrameIds } from '../frames'
import { createMetricsObserver } from '../observers/metrics'

describe('createMetricsObserver', () => {
  beforeEach(() => {
    resetFrameIds()
  })

  it('tracks frame counts by kind', () => {
    const observer = createMetricsObserver()
    observer.onRunStart!(1)

    observer.onFrame(createFrame('agent-text-delta', { delta: 'a', accumulatedText: 'a' }))
    observer.onFrame(createFrame('agent-text-delta', { delta: 'b', accumulatedText: 'ab' }))
    observer.onFrame(
      createFrame('tool-call-start', {
        toolCall: { id: 't1', index: 0, name: 'bash', input: {}, status: 'running' },
      }),
    )

    const metrics = observer.getMetrics()
    expect(metrics).not.toBeNull()
    expect(metrics!.frameCounts['agent-text-delta']).toBe(2)
    expect(metrics!.frameCounts['tool-call-start']).toBe(1)
  })

  it('tracks total text characters', () => {
    const observer = createMetricsObserver()
    observer.onRunStart!(1)

    observer.onFrame(createFrame('agent-text-delta', { delta: 'hello', accumulatedText: 'hello' }))
    observer.onFrame(
      createFrame('agent-text-delta', { delta: ' world', accumulatedText: 'hello world' }),
    )

    const metrics = observer.getMetrics()
    expect(metrics!.totalTextChars).toBe(11) // 'hello' + ' world'
  })

  it('tracks tool call and error counts', () => {
    const observer = createMetricsObserver()
    observer.onRunStart!(1)

    observer.onFrame(
      createFrame('tool-call-start', {
        toolCall: { id: 't1', index: 0, name: 'bash', input: {}, status: 'running' },
      }),
    )
    observer.onFrame(
      createFrame('tool-call-start', {
        toolCall: { id: 't2', index: 1, name: 'readFile', input: {}, status: 'running' },
      }),
    )
    observer.onFrame(
      createFrame('tool-call-result', {
        toolIndex: 0,
        result: 'ok',
        status: 'complete',
      }),
    )
    observer.onFrame(
      createFrame('tool-call-result', {
        toolIndex: 1,
        result: 'not found',
        status: 'error',
      }),
    )

    const metrics = observer.getMetrics()
    expect(metrics!.toolCallCount).toBe(2)
    expect(metrics!.toolErrorCount).toBe(1)
  })

  it('records first token latency', () => {
    const observer = createMetricsObserver()
    observer.onRunStart!(1)

    // Small delay to ensure measurable latency
    observer.onFrame(createFrame('agent-text-delta', { delta: 'a', accumulatedText: 'a' }))
    observer.onFrame(createFrame('agent-text-delta', { delta: 'b', accumulatedText: 'ab' }))

    const metrics = observer.getMetrics()
    expect(metrics!.agentFirstTokenMs).toBeDefined()
    // First token should be recorded only once
    expect(typeof metrics!.agentFirstTokenMs).toBe('number')
  })

  it('tracks TTS error count', () => {
    const observer = createMetricsObserver()
    observer.onRunStart!(1)

    observer.onFrame(
      createFrame('tts-error', {
        errorType: 'generation_failed',
        message: 'timeout',
      }),
    )

    const metrics = observer.getMetrics()
    expect(metrics!.ttsErrorCount).toBe(1)
  })

  it('preserves tracked metrics when the run ends', () => {
    const observer = createMetricsObserver()
    observer.onRunStart!(1)

    observer.onFrame(createFrame('agent-text-delta', { delta: 'hello', accumulatedText: 'hello' }))
    observer.onFrame(
      createFrame('tool-call-start', {
        toolCall: { id: 't1', index: 0, name: 'bash', input: {}, status: 'running' },
      }),
    )

    observer.onRunEnd!({
      runId: 1,
      startTime: 0,
      endTime: 123,
      totalTextChars: 0,
      toolCallCount: 0,
      toolErrorCount: 0,
      ttsErrorCount: 0,
      frameCounts: {},
    })

    const metrics = observer.getMetrics()
    expect(metrics).not.toBeNull()
    expect(metrics!.endTime).toBe(123)
    expect(metrics!.totalTextChars).toBe(5)
    expect(metrics!.toolCallCount).toBe(1)
    expect(metrics!.frameCounts['agent-text-delta']).toBe(1)
  })
})
