import type { Frame } from './frames'

export interface PipelineMetrics {
  runId: number
  startTime: number
  endTime?: number

  /** ms from run start to first AgentTextDeltaFrame */
  agentFirstTokenMs?: number
  /** ms from run start to AgentTextCompleteFrame */
  agentCompleteMs?: number
  /** total characters across all text deltas */
  totalTextChars: number
  toolCallCount: number
  toolErrorCount: number

  /** ms from run start to first TTSSpeakingStartFrame */
  ttsSpeakingStartMs?: number
  /** ms from run start to last TTSSpeakingEndFrame */
  ttsSpeakingEndMs?: number
  ttsErrorCount: number

  /** frame counts by kind */
  frameCounts: Record<string, number>
}

export interface PipelineObserver {
  /** Called for every frame flowing through the pipeline */
  onFrame(frame: Frame): void

  /** Called when a run starts */
  onRunStart?(runId: number): void

  /** Called when a run completes (with full metrics) */
  onRunEnd?(metrics: PipelineMetrics): void
}
