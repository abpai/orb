export type AppState = 'idle' | 'processing' | 'processing_speaking' | 'speaking'

export type DetailMode = 'compact' | 'expanded'

export type TTSErrorType =
  | 'command_not_found'
  | 'audio_playback'
  | 'generation_failed'
  | 'player_not_found'

export class TTSError extends Error {
  constructor(
    message: string,
    public readonly type: TTSErrorType,
    public readonly originalError?: Error,
  ) {
    super(message)
    this.name = 'TTSError'
  }
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  status: 'running' | 'complete' | 'error'
  result?: string
}

export interface HistoryEntry {
  id: string
  question: string
  toolCalls: ToolCall[]
  answer: string
  error?: string | null
}

export type LlmProvider = 'anthropic' | 'openai' | 'gemini'

export const VOICES = ['alba', 'marius', 'jean'] as const
export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

export type AnthropicModel = string
export type LlmModelId = string
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
export type Voice = (typeof VOICES)[number]

export interface OpenAiSession {
  provider: 'openai'
  threadId: string
}

export type AgentSession = { provider: 'anthropic'; sessionId: string } | OpenAiSession

/** Where a listed session came from: orb's own store, Claude Code, or Codex. */
export type SessionSource = 'orb' | 'claude' | 'codex'

/**
 * Describes an external session resumed with empty scrollback, so the UI can
 * reassure the user that prior history is hidden but the model still has it.
 */
export interface ResumeInfo {
  source: 'claude' | 'codex'
  messageCount?: number
}

export interface SavedSession {
  version: 2
  /** Stable per-conversation id, minted once when a fresh conversation starts. */
  id: string
  projectPath: string
  llmProvider: LlmProvider
  llmModel: LlmModelId
  agentSession?: AgentSession
  lastModified: string
  history: HistoryEntry[]
}

export interface AppConfig {
  projectPath: string
  llmProvider: LlmProvider
  llmModel: LlmModelId
  llmReasoningEffort: ReasoningEffort
  llmModelChoices?: LlmModelId[]
  llmModelLabels?: Record<LlmModelId, string>
  ttsVoice: Voice
  ttsMode: 'generate' | 'serve'
  ttsServerUrl?: string
  ttsSpeed: number
  ttsEnabled: boolean
  ttsStreamingEnabled: boolean
  ttsBufferSentences: number
  ttsClauseBoundaries: boolean
  ttsMinChunkLength: number
  ttsMaxWaitMs: number
  ttsGraceWindowMs: number
  resumeSession?: AgentSession
  /** When set, resume this specific saved session id instead of the latest. */
  resumeId?: string
  startFresh: boolean
  skipIntro: boolean
  yolo: boolean
}

export const DEFAULT_CONFIG: AppConfig = {
  projectPath: process.cwd(),
  llmProvider: 'openai',
  llmModel: 'gpt-5.5',
  llmReasoningEffort: 'high',
  ttsVoice: 'alba',
  ttsMode: 'serve',
  ttsSpeed: 1.5,
  ttsEnabled: true,
  ttsStreamingEnabled: true,
  ttsBufferSentences: 1,
  ttsClauseBoundaries: false,
  ttsMinChunkLength: 15,
  ttsMaxWaitMs: 150,
  ttsGraceWindowMs: 50,
  startFresh: false,
  skipIntro: false,
  yolo: false,
}
