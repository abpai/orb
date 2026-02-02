export type AppState = 'idle' | 'processing' | 'processing_speaking' | 'speaking'

export type ViewMode = 'main' | 'transcript'

export type TTSErrorType = 'command_not_found' | 'audio_playback' | 'generation_failed'

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
  index: number
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

export type LlmProvider = 'anthropic' | 'openai'

export const ANTHROPIC_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-20250514',
] as const

export const VOICES = ['alba', 'marius', 'jean'] as const

export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number]
export type LlmModelId = string
export type Voice = (typeof VOICES)[number]

export interface OpenAiMessage {
  role: 'user' | 'assistant'
  content: string
}

export type AgentSession =
  | { provider: 'anthropic'; sessionId: string }
  | { provider: 'openai'; messages: OpenAiMessage[] }

export interface SavedSession {
  version: 2
  projectPath: string
  llmProvider: LlmProvider
  llmModel: LlmModelId
  agentSession?: AgentSession
  lastModified: string
  history: HistoryEntry[]
}

export interface AppConfig {
  projectPath: string
  permissionMode: 'default' | 'acceptEdits'
  llmProvider: LlmProvider
  llmModel: LlmModelId
  openaiApiKey?: string
  openaiLogin: boolean
  openaiDeviceLogin: boolean
  openaiApi: 'responses' | 'chat'
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
  startFresh: boolean
}

export const DEFAULT_CONFIG: AppConfig = {
  projectPath: process.cwd(),
  permissionMode: 'default',
  llmProvider: 'anthropic',
  llmModel: 'claude-haiku-4-5-20251001',
  openaiLogin: false,
  openaiDeviceLogin: false,
  openaiApi: 'responses',
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
}
