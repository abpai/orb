export type AppState = 'idle' | 'processing' | 'processing_speaking' | 'speaking'

export type ViewMode = 'main' | 'transcript'

export type TTSErrorType = 'command_not_found' | 'audio_playback' | 'generation_failed' | 'unknown'

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

export interface SavedSession {
  version: 1
  projectPath: string
  sessionId: string
  model: Model
  lastModified: string
  history: HistoryEntry[]
}

export const MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-20250514',
] as const

export const VOICES = ['alba', 'marius', 'jean'] as const

export type Model = (typeof MODELS)[number]
export type Voice = (typeof VOICES)[number]

export interface AppConfig {
  projectPath: string
  permissionMode: 'default' | 'acceptEdits'
  model: Model
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
  model: 'claude-haiku-4-5-20251001',
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
