import type { Frame } from '../frames'
import type { PipelineMetrics, PipelineObserver } from '../observer'

/**
 * Tracks timing and counts for each pipeline run.
 * Call getMetrics() after onRunEnd to retrieve the snapshot.
 */
export function createMetricsObserver(): PipelineObserver & {
  getMetrics(): PipelineMetrics | null
} {
  let current: PipelineMetrics | null = null
  let lastCompleted: PipelineMetrics | null = null

  function ensureMetrics(runId: number): PipelineMetrics {
    if (!current || current.runId !== runId) {
      current = {
        runId,
        startTime: Date.now(),
        totalTextChars: 0,
        toolCallCount: 0,
        toolErrorCount: 0,
        ttsErrorCount: 0,
        frameCounts: {},
      }
    }
    return current
  }

  return {
    onFrame(frame: Frame): void {
      if (!current) return
      const m = current
      const elapsed = Date.now() - m.startTime

      // Count every frame by kind
      m.frameCounts[frame.kind] = (m.frameCounts[frame.kind] ?? 0) + 1

      switch (frame.kind) {
        case 'agent-text-delta':
          if (m.agentFirstTokenMs === undefined) {
            m.agentFirstTokenMs = elapsed
          }
          m.totalTextChars += frame.delta.length
          break

        case 'agent-text-complete':
          m.agentCompleteMs = elapsed
          break

        case 'tool-call-start':
          m.toolCallCount++
          break

        case 'tool-call-result':
          if (frame.status === 'error') m.toolErrorCount++
          break

        case 'tts-speaking-start':
          if (m.ttsSpeakingStartMs === undefined) {
            m.ttsSpeakingStartMs = elapsed
          }
          break

        case 'tts-speaking-end':
          m.ttsSpeakingEndMs = elapsed
          break

        case 'tts-error':
          m.ttsErrorCount++
          break
      }
    },

    onRunStart(runId: number): void {
      ensureMetrics(runId)
    },

    onRunEnd(metrics: PipelineMetrics): void {
      if (current) {
        lastCompleted = {
          ...current,
          endTime: metrics.endTime ?? Date.now(),
        }
        current = null
        return
      }

      lastCompleted = metrics
    },

    getMetrics(): PipelineMetrics | null {
      return lastCompleted ?? current
    },
  }
}
