import type { ToolCall, AgentSession } from '../../types'

export interface AgentCallbacks {
  onToolCall?: (call: ToolCall) => void
  onToolResult?: (index: number, result: string) => void
  onToolError?: (index: number, error: string) => void
  onAssistantText?: (text: string) => void
  onSessionId?: (sessionId: string) => void
}

export interface AgentRunResult {
  text: string
  session?: AgentSession
}

// Voice-aware system prompt for TTS-friendly responses
export const VOICE_SYSTEM_PROMPT = `You are a helpful coding assistant responding via voice.

Guidelines for voice responses:
- Keep responses concise: 2-4 sentences for simple questions, up to a paragraph for complex topics
- Use conversational, natural language that sounds good when spoken aloud
- Avoid code blocks, markdown formatting, bullet lists, and technical symbols
- When discussing code, describe it verbally rather than showing syntax
- End with a follow-up question or offer to elaborate if the topic warrants it
- If a question requires showing code, briefly explain what you would write and ask if they'd like details

Remember: Your response will be read aloud, so optimize for listening, not reading.`
