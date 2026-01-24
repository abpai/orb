import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AppConfig, ToolCall } from '../types'

// Voice-aware system prompt for TTS-friendly responses
const VOICE_SYSTEM_PROMPT = `You are a helpful coding assistant responding via voice.

Guidelines for voice responses:
- Keep responses concise: 2-4 sentences for simple questions, up to a paragraph for complex topics
- Use conversational, natural language that sounds good when spoken aloud
- Avoid code blocks, markdown formatting, bullet lists, and technical symbols
- When discussing code, describe it verbally rather than showing syntax
- End with a follow-up question or offer to elaborate if the topic warrants it
- If a question requires showing code, briefly explain what you would write and ask if they'd like details

Remember: Your response will be read aloud, so optimize for listening, not reading.`

export interface AgentCallbacks {
  onToolCall?: (call: ToolCall) => void
  onToolResult?: (index: number, result: string) => void
  onToolError?: (index: number, error: string) => void
  onAssistantText?: (text: string) => void
  onSessionId?: (sessionId: string) => void
}

export async function runAgent(
  prompt: string,
  config: AppConfig,
  sessionId: string | undefined,
  callbacks: AgentCallbacks,
  abortController?: AbortController,
): Promise<string> {
  let activeSessionId = sessionId
  let assistantText = ''
  let finalResult = ''
  let toolIndex = 0
  const toolIdToIndex = new Map<string, number>()

  const response = query({
    prompt,
    options: {
      cwd: config.projectPath,
      model: config.model,
      maxTurns: 10,
      resume: activeSessionId,
      permissionMode: config.permissionMode === 'acceptEdits' ? 'bypassPermissions' : 'default',
      abortController,
      // Inject voice-aware system prompt when TTS is enabled
      ...(config.ttsEnabled && { systemPrompt: VOICE_SYSTEM_PROMPT }),
    },
  })

  for await (const message of response) {
    const typed = message as SDKMessage

    if (typed.type === 'system' && typed.subtype === 'init') {
      const newSessionId = (typed as { session_id?: string }).session_id
      if (newSessionId) {
        activeSessionId = newSessionId
        callbacks.onSessionId?.(newSessionId)
      }
      continue
    }

    if (typed.type === 'assistant') {
      const blocks = getContentBlocks(typed.message)
      for (const block of blocks) {
        if (isTextBlock(block)) {
          const text = block.text
          assistantText += text
          callbacks.onAssistantText?.(text)
          continue
        }
        if (isToolUseBlock(block)) {
          const toolId = block.id ?? block.tool_use_id ?? `tool-${toolIndex}`
          const index = toolIdToIndex.get(toolId) ?? toolIndex++
          toolIdToIndex.set(toolId, index)
          const call: ToolCall = {
            id: toolId,
            index,
            name: block.name,
            input: block.input ?? {},
            status: 'running',
          }
          callbacks.onToolCall?.(call)
        }
      }
      continue
    }

    if (typed.type === 'user') {
      const blocks = getContentBlocks(typed.message)
      for (const block of blocks) {
        if (!isToolResultBlock(block)) continue
        const toolUseId = block.tool_use_id ?? block.id
        const resultText = extractToolResultText(block.content)
        const isError = !!block.is_error
        const index = toolUseId ? toolIdToIndex.get(toolUseId) : undefined
        if (index !== undefined) {
          if (isError) {
            callbacks.onToolError?.(index, resultText)
          } else {
            callbacks.onToolResult?.(index, resultText)
          }
        }
      }
    }

    if (typed.type === 'result' && typed.subtype === 'success') {
      finalResult = typed.result
    }
  }

  return finalResult || assistantText
}

type TextBlock = { type: 'text'; text: string }
type ToolUseBlock = {
  type: 'tool_use'
  id?: string
  tool_use_id?: string
  name: string
  input?: Record<string, unknown>
}
type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id?: string
  id?: string
  content?: unknown
  is_error?: boolean
}

function getContentBlocks(message: unknown): unknown[] {
  if (typeof message === 'string') {
    return [{ type: 'text', text: message }]
  }
  if (!message || typeof message !== 'object') return []
  const content = (message as { content?: unknown }).content
  return Array.isArray(content) ? content : []
}

function isTextBlock(value: unknown): value is TextBlock {
  return typeof value === 'object' && value !== null && (value as TextBlock).type === 'text'
}

function isToolUseBlock(value: unknown): value is ToolUseBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ToolUseBlock).type === 'tool_use' &&
    typeof (value as ToolUseBlock).name === 'string'
  )
}

function isToolResultBlock(value: unknown): value is ToolResultBlock {
  return (
    typeof value === 'object' && value !== null && (value as ToolResultBlock).type === 'tool_result'
  )
}

function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const typedBlock = block as { type?: string; text?: string }
        if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
          return typedBlock.text
        }
        return ''
      })
      .join('')
  }
  if (content && typeof content === 'object' && 'text' in (content as Record<string, unknown>)) {
    return String((content as { text?: unknown }).text ?? '')
  }
  return ''
}
