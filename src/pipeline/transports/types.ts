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
 * Outbound: task → UI (agent/TTS frames for rendering)
 */
export interface Transport {
  /** Subscribe to outbound frames (UI listens here) */
  onOutbound(listener: (frame: OutboundFrame) => void): () => void

  /** Send an outbound frame from the task side */
  sendOutbound(frame: OutboundFrame): void
}
