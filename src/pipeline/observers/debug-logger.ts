import type { Frame } from '../frames'
import type { PipelineMetrics, PipelineObserver } from '../observer'

/**
 * Logs frame flow to stderr for development debugging.
 * Optionally filters to specific frame kinds.
 */
export function createDebugLogObserver(filter?: Frame['kind'][]): PipelineObserver {
  const allowedKinds = filter ? new Set(filter) : null

  return {
    onFrame(frame: Frame): void {
      if (allowedKinds && !allowedKinds.has(frame.kind)) return

      const ts = new Date(frame.timestamp).toISOString().slice(11, 23)
      const detail = formatFrameDetail(frame)
      process.stderr.write(`[pipeline] ${ts} #${frame.id} ${frame.kind}${detail}\n`)
    },

    onRunStart(runId: number): void {
      process.stderr.write(`[pipeline] === Run #${runId} started ===\n`)
    },

    onRunEnd(metrics: PipelineMetrics): void {
      const duration = metrics.endTime ? metrics.endTime - metrics.startTime : '?'
      process.stderr.write(
        `[pipeline] === Run #${metrics.runId} ended (${duration}ms, ${metrics.totalTextChars} chars, ${metrics.toolCallCount} tools) ===\n`,
      )
    },
  }
}

function formatFrameDetail(frame: Frame): string {
  switch (frame.kind) {
    case 'agent-text-delta':
      return ` delta="${truncate(frame.delta, 40)}"`
    case 'agent-text-complete':
      return ` text="${truncate(frame.text, 60)}"`
    case 'tool-call-start':
      return ` tool=${frame.toolCall.name}`
    case 'tool-call-result':
      return ` idx=${frame.toolIndex} status=${frame.status}`
    case 'agent-error':
      return ` error="${frame.error.message}"`
    case 'tts-error':
      return ` type=${frame.errorType}`
    default:
      return ''
  }
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 1) + '\u2026'
}
