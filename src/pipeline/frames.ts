import type { AgentSession, ToolCall, TTSErrorType } from '../types'

// ── Base ──

interface BaseFrame {
  id: number
  timestamp: number
}

// ── User Input ──

export interface UserTextFrame extends BaseFrame {
  kind: 'user-text'
  text: string
  entryId: string
}

// ── Agent Output ──

export interface AgentTextDeltaFrame extends BaseFrame {
  kind: 'agent-text-delta'
  delta: string
  accumulatedText: string
}

export interface AgentTextCompleteFrame extends BaseFrame {
  kind: 'agent-text-complete'
  text: string
  session?: AgentSession
}

export interface ToolCallStartFrame extends BaseFrame {
  kind: 'tool-call-start'
  toolCall: ToolCall
}

export interface ToolCallResultFrame extends BaseFrame {
  kind: 'tool-call-result'
  toolIndex: number
  result: string
  status: 'complete' | 'error'
}

export interface AgentSessionFrame extends BaseFrame {
  kind: 'agent-session'
  session: AgentSession
}

export interface AgentErrorFrame extends BaseFrame {
  kind: 'agent-error'
  error: Error
}

// ── TTS ──

export interface TTSSpeakingStartFrame extends BaseFrame {
  kind: 'tts-speaking-start'
}

export interface TTSSpeakingEndFrame extends BaseFrame {
  kind: 'tts-speaking-end'
}

export interface TTSErrorFrame extends BaseFrame {
  kind: 'tts-error'
  errorType: TTSErrorType
  message: string
}

export interface TTSPendingFrame extends BaseFrame {
  kind: 'tts-pending'
  waitForCompletion: () => Promise<void>
  stop: () => void
}

// ── Control ──

export interface CancelFrame extends BaseFrame {
  kind: 'cancel'
}

export interface EndFrame extends BaseFrame {
  kind: 'end'
  reason: 'complete' | 'cancelled' | 'error'
  error?: Error
}

// ── Union ──

export type Frame =
  | UserTextFrame
  | AgentTextDeltaFrame
  | AgentTextCompleteFrame
  | ToolCallStartFrame
  | ToolCallResultFrame
  | AgentSessionFrame
  | AgentErrorFrame
  | TTSSpeakingStartFrame
  | TTSSpeakingEndFrame
  | TTSErrorFrame
  | TTSPendingFrame
  | CancelFrame
  | EndFrame

// ── Factory ──

let nextId = 0

type FrameOfKind<K extends Frame['kind']> = Extract<Frame, { kind: K }>
type FrameData<K extends Frame['kind']> = Omit<FrameOfKind<K>, 'id' | 'timestamp' | 'kind'>

export function createFrame<K extends Frame['kind']>(
  kind: K,
  ...[data]: FrameData<K> extends Record<string, never> ? [] : [FrameData<K>]
): FrameOfKind<K> {
  return {
    kind,
    id: nextId++,
    timestamp: Date.now(),
    ...(data ?? {}),
  } as FrameOfKind<K>
}

/** Reset frame ID counter (for testing) */
export function resetFrameIds(): void {
  nextId = 0
}
