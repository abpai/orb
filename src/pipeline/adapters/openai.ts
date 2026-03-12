import { createBashTool } from 'bash-tool'
import { ToolLoopAgent, stepCountIs, type ToolSet, type StepResult } from 'ai'
import type { OpenAiMessage } from '../../types'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { AgentAdapter, AgentAdapterConfig } from './types'
import { normalizeToolInput, isToolError, formatToolResult } from './utils'
import { resolveOpenAiProvider, validateCodexModel } from '../../services/openai-auth'

const BASE_INSTRUCTIONS = `You are a helpful coding assistant.

The project is mounted at /workspace.
Use the provided bash, readFile, and writeFile tools to explore or edit files.
Edits happen in a sandbox overlay; describe any changes you make.
Never claim to be Claude or Anthropic; you are an OpenAI model.
Prefer concise bash commands (ls, rg, sed, awk, jq) and keep outputs short.
If you need to modify files, do so via writeFile so changes are explicit.`

const VOICE_SYSTEM_PROMPT = `You are a helpful coding assistant responding via voice.

Guidelines for voice responses:
- Keep responses concise: 2-4 sentences for simple questions, up to a paragraph for complex topics
- Use conversational, natural language that sounds good when spoken aloud
- Avoid code blocks, markdown formatting, bullet lists, and technical symbols
- When discussing code, describe it verbally rather than showing syntax
- End with a follow-up question or offer to elaborate if the topic warrants it
- If a question requires showing code, briefly explain what you would write and ask if they'd like details

Remember: Your response will be read aloud, so optimize for listening, not reading.`

interface OaiToolCall {
  toolCallId: string
  toolName: string
  input: unknown
}

interface OaiToolResult {
  toolCallId: string
  toolName: string
  output: unknown
}

function buildConversationPrompt(messages: OpenAiMessage[]): string {
  return messages
    .map((message) => {
      const label = message.role === 'user' ? 'User' : 'Assistant'
      return `${label}: ${message.content}`
    })
    .join('\n\n')
}

export function createOpenAiAdapter(config: AgentAdapterConfig): AgentAdapter {
  return {
    async *stream(prompt: string): AsyncIterable<Frame> {
      const { appConfig, session, abortController } = config
      const priorMessages = session?.provider === 'openai' ? session.messages : []
      const nextMessages: OpenAiMessage[] = [...priorMessages, { role: 'user', content: prompt }]
      const conversationPrompt = buildConversationPrompt(nextMessages)
      const instructions = appConfig.ttsEnabled
        ? `${BASE_INSTRUCTIONS}\n\n${VOICE_SYSTEM_PROMPT}`
        : BASE_INSTRUCTIONS

      const { tools, sandbox } = await createBashTool({
        uploadDirectory: {
          source: appConfig.projectPath,
          include: '**/*',
        },
        maxFiles: 5000,
      })

      const { bash, readFile, writeFile } = tools
      const allowedTools: ToolSet = { bash, readFile, writeFile }

      let accumulatedText = ''
      let toolIndex = 0
      const toolIdToIndex = new Map<string, number>()
      const pendingFrames: Frame[] = []

      function getOrCreateIndex(toolId: string): number {
        const existing = toolIdToIndex.get(toolId)
        if (existing !== undefined) return existing
        const index = toolIndex++
        toolIdToIndex.set(toolId, index)
        return index
      }

      function registerToolCall(call: OaiToolCall): void {
        const index = getOrCreateIndex(call.toolCallId)
        pendingFrames.push(
          createFrame('tool-call-start', {
            toolCall: {
              id: call.toolCallId,
              index,
              name: call.toolName,
              input: normalizeToolInput(call.input),
              status: 'running',
            },
          }),
        )
      }

      function registerToolResult(result: OaiToolResult): void {
        const existingIndex = toolIdToIndex.get(result.toolCallId)
        const index = getOrCreateIndex(result.toolCallId)

        if (existingIndex === undefined) {
          pendingFrames.push(
            createFrame('tool-call-start', {
              toolCall: {
                id: result.toolCallId,
                index,
                name: result.toolName,
                input: {},
                status: 'running',
              },
            }),
          )
        }

        const text = formatToolResult(result.output)
        pendingFrames.push(
          createFrame('tool-call-result', {
            toolIndex: index,
            result: text,
            status: isToolError(result.output) ? 'error' : 'complete',
          }),
        )
      }

      const { provider, source: authSource } = await resolveOpenAiProvider(appConfig)

      if (authSource === 'chatgpt') {
        validateCodexModel(appConfig.llmModel)
      }

      const effectiveApi = authSource === 'chatgpt' ? 'chat' : appConfig.openaiApi

      const buildModel = (api: 'responses' | 'chat') =>
        api === 'chat'
          ? provider.chat(appConfig.llmModel as never)
          : provider.responses(appConfig.llmModel as never)

      const runStream = async function* (api: 'responses' | 'chat'): AsyncIterable<Frame> {
        accumulatedText = ''
        toolIndex = 0
        toolIdToIndex.clear()
        pendingFrames.length = 0

        const agent = new ToolLoopAgent({
          model: buildModel(api),
          instructions,
          tools: allowedTools,
          stopWhen: stepCountIs(20),
        })

        const agentStream = await agent.stream({
          prompt: conversationPrompt,
          onStepFinish: (stepResult: StepResult<ToolSet>) => {
            for (const call of stepResult.toolCalls) {
              registerToolCall(call)
            }
            for (const result of stepResult.toolResults) {
              registerToolResult(result)
            }
          },
          abortSignal: abortController.signal,
        })

        for await (const chunk of agentStream.textStream) {
          // Drain any tool frames that arrived via onStepFinish
          while (pendingFrames.length > 0) {
            yield pendingFrames.shift()!
          }

          accumulatedText += chunk
          yield createFrame('agent-text-delta', {
            delta: chunk,
            accumulatedText,
          })
        }

        // Drain remaining tool frames after text stream ends
        while (pendingFrames.length > 0) {
          yield pendingFrames.shift()!
        }
      }

      try {
        let succeeded = false
        try {
          yield* runStream(effectiveApi)
          succeeded = true
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const canFallback =
            effectiveApi === 'responses' && message.includes('api.responses.write')
          if (!canFallback) throw err
          yield* runStream('chat')
          succeeded = true
        }

        if (succeeded) {
          const updatedMessages: OpenAiMessage[] = [
            ...nextMessages,
            { role: 'assistant', content: accumulatedText },
          ]
          yield createFrame('agent-text-complete', {
            text: accumulatedText,
            session: { provider: 'openai', messages: updatedMessages },
          })
        }
      } finally {
        if ('stop' in sandbox && typeof sandbox.stop === 'function') {
          await (sandbox.stop as () => Promise<void>)().catch(() => {})
        }
      }
    },
  }
}
