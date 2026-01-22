export type AppState = 'idle' | 'processing' | 'speaking'

export type TTSErrorType =
  | 'command_not_found' // pocket-tts not installed
  | 'audio_playback' // afplay failed
  | 'generation_failed' // pocket-tts exited non-zero
  | 'unknown'

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

export interface AppConfig {
  projectPath: string
  permissionMode: 'default' | 'acceptEdits'
  maxBudgetUsd?: number
  model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-5-20250929' | 'claude-opus-4-20250514'
  ttsVoice: 'alba' | 'marius' | 'jean'
  ttsMode: 'generate' | 'serve'
  ttsServerUrl?: string
  ttsSpeed: number
  ttsEnabled: boolean
}

export const DEFAULT_CONFIG: AppConfig = {
  projectPath: process.cwd(),
  permissionMode: 'default',
  model: 'claude-haiku-4-5-20251001',
  ttsVoice: 'alba',
  ttsMode: 'serve',
  ttsSpeed: 1.5,
  ttsEnabled: true,
}
