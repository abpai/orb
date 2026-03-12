import type {
  AgentTextDeltaFrame,
  AgentTextCompleteFrame,
  ToolCallStartFrame,
  ToolCallResultFrame,
  AgentErrorFrame,
  TTSSpeakingStartFrame,
  TTSSpeakingEndFrame,
  TTSErrorFrame,
} from '../frames'
import type { LlmModelId } from '../../types'

/** Events the UI sends to the pipeline task */
export type InboundEvent =
  | { kind: 'submit'; query: string }
  | { kind: 'cancel' }
  | { kind: 'model-change'; model: LlmModelId }

/** Frames the pipeline task sends to the UI */
export type OutboundFrame =
  | AgentTextDeltaFrame
  | AgentTextCompleteFrame
  | ToolCallStartFrame
  | ToolCallResultFrame
  | AgentErrorFrame
  | TTSSpeakingStartFrame
  | TTSSpeakingEndFrame
  | TTSErrorFrame

/**
 * Transport: boundary between pipeline system and UI.
 * Inbound: UI → task (submit, cancel, model change)
 * Outbound: task → UI (agent/TTS frames for rendering)
 */
export interface Transport {
  /** Subscribe to inbound events from the UI */
  onInbound(listener: (event: InboundEvent) => void): () => void

  /** Emit an inbound event from the UI side */
  emitInbound(event: InboundEvent): void

  /** Subscribe to outbound frames (UI listens here) */
  onOutbound(listener: (frame: OutboundFrame) => void): () => void

  /** Send an outbound frame from the task side */
  sendOutbound(frame: OutboundFrame): void

  /** Clean up all listeners */
  dispose(): void
}
