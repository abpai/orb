import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentSession, AppConfig, ToolCall } from '../../types'
import { VOICE_SYSTEM_PROMPT, type AgentCallbacks, type AgentRunResult } from './types'

export async function runAnthropicAgent(
  prompt: string,
  config: AppConfig,
  session: AgentSession | undefined,
  callbacks: AgentCallbacks,
  abortController?: AbortController,
): Promise<AgentRunResult> {
  let activeSessionId = session?.provider === 'anthropic' ? session.sessionId : undefined
  let assistantText = ''
  let finalResult = ''
  let toolIndex = 0
  const toolIdToIndex = new Map<string, number>()

  const response = query({
    prompt,
    options: {
      cwd: config.projectPath,
      model: config.llmModel,
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
        const index = toolUseId ? toolIdToIndex.get(toolUseId) : undefined
        if (index === undefined) continue

        const resultText = extractToolResultText(block.content)
        const callback = block.is_error ? callbacks.onToolError : callbacks.onToolResult
        callback?.(index, resultText)
      }
    }

    if (typed.type === 'result' && typed.subtype === 'success') {
      finalResult = typed.result
    }
  }

  return {
    text: finalResult || assistantText,
    session: activeSessionId ? { provider: 'anthropic', sessionId: activeSessionId } : undefined,
  }
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

function hasType(value: unknown, type: string): value is { type: string } {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === type
}

function isTextBlock(value: unknown): value is TextBlock {
  return hasType(value, 'text')
}

function isToolUseBlock(value: unknown): value is ToolUseBlock {
  return hasType(value, 'tool_use') && typeof (value as ToolUseBlock).name === 'string'
}

function isToolResultBlock(value: unknown): value is ToolResultBlock {
  return hasType(value, 'tool_result')
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
