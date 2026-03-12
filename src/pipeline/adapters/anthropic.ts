import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { AgentAdapter, AgentAdapterConfig } from './types'
import {
  getContentBlocks,
  isTextBlock,
  isToolUseBlock,
  isToolResultBlock,
  extractToolResultText,
} from './utils'

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

export function createAnthropicAdapter(config: AgentAdapterConfig): AgentAdapter {
  return {
    async *stream(prompt: string): AsyncIterable<Frame> {
      const { appConfig, session, abortController } = config
      let activeSessionId = session?.provider === 'anthropic' ? session.sessionId : undefined
      let accumulatedText = ''
      let toolIndex = 0
      const toolIdToIndex = new Map<string, number>()

      const response = query({
        prompt,
        options: {
          cwd: appConfig.projectPath,
          model: appConfig.llmModel,
          maxTurns: 10,
          resume: activeSessionId,
          permissionMode:
            appConfig.permissionMode === 'acceptEdits' ? 'bypassPermissions' : 'default',
          abortController,
          ...(appConfig.ttsEnabled && { systemPrompt: VOICE_SYSTEM_PROMPT }),
        },
      })

      for await (const message of response) {
        const typed = message as SDKMessage

        if (typed.type === 'system' && typed.subtype === 'init') {
          const newSessionId = (typed as { session_id?: string }).session_id
          if (newSessionId) {
            activeSessionId = newSessionId
            yield createFrame('agent-session', {
              session: { provider: 'anthropic', sessionId: newSessionId },
            })
          }
          continue
        }

        if (typed.type === 'assistant') {
          const blocks = getContentBlocks(typed.message)
          for (const block of blocks) {
            if (isTextBlock(block)) {
              accumulatedText += block.text
              yield createFrame('agent-text-delta', {
                delta: block.text,
                accumulatedText,
              })
              continue
            }
            if (isToolUseBlock(block)) {
              const toolId = block.id ?? block.tool_use_id ?? `tool-${toolIndex}`
              const index = toolIdToIndex.get(toolId) ?? toolIndex++
              toolIdToIndex.set(toolId, index)
              yield createFrame('tool-call-start', {
                toolCall: {
                  id: toolId,
                  index,
                  name: block.name,
                  input: block.input ?? {},
                  status: 'running',
                },
              })
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
            yield createFrame('tool-call-result', {
              toolIndex: index,
              result: resultText,
              status: block.is_error ? 'error' : 'complete',
            })
          }
        }

        if (typed.type === 'result' && typed.subtype === 'success') {
          yield createFrame('agent-text-complete', {
            text: typed.result || accumulatedText,
            session: activeSessionId
              ? { provider: 'anthropic', sessionId: activeSessionId }
              : undefined,
          })
        }
      }
    },
  }
}
