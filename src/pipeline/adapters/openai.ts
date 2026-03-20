import { createBashTool } from 'bash-tool'
import { ToolLoopAgent, stepCountIs, type ToolSet, type StepResult } from 'ai'
import { buildProviderPrompt } from '../../services/prompts'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { AgentAdapter, AgentAdapterConfig } from './types'
import { normalizeToolInput, isToolError, formatToolResult } from './utils'
import { resolveOpenAiProvider } from '../../services/openai-auth'

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

export function createOpenAiAdapter(config: AgentAdapterConfig): AgentAdapter {
  return {
    async *stream(prompt: string): AsyncIterable<Frame> {
      const { appConfig, session, abortController } = config
      const previousResponseId =
        session?.provider === 'openai' ? session.previousResponseId : undefined
      const instructions = await buildProviderPrompt({
        provider: 'openai',
        projectPath: appConfig.projectPath,
        ttsEnabled: appConfig.ttsEnabled,
      })

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

      const { provider } = await resolveOpenAiProvider(appConfig)
      const model = provider.responses(appConfig.llmModel as never)

      let finalResponseId: string | undefined

      const runStream = async function* (continuationResponseId?: string): AsyncIterable<Frame> {
        accumulatedText = ''
        toolIndex = 0
        toolIdToIndex.clear()
        pendingFrames.length = 0

        const agent = new ToolLoopAgent({
          model,
          ...(continuationResponseId ? {} : { instructions }),
          tools: allowedTools,
          stopWhen: stepCountIs(20),
          providerOptions: {
            openai: {
              truncation: 'auto',
              ...(continuationResponseId
                ? {
                    previousResponseId: continuationResponseId,
                    instructions,
                  }
                : {}),
            },
          },
        })

        const agentStream = await agent.stream({
          prompt,
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

        finalResponseId = (await agentStream.response).id
      }

      const isInvalidContinuationError = (err: unknown): boolean => {
        if (!previousResponseId) return false
        const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
        const statusCode =
          typeof err === 'object' && err !== null && 'statusCode' in err
            ? (err as { statusCode?: number }).statusCode
            : undefined

        return (
          statusCode === 400 ||
          statusCode === 404 ||
          message.includes('previous_response_id') ||
          message.includes('previous response') ||
          message.includes('conversation')
        )
      }

      try {
        try {
          yield* runStream(previousResponseId)
        } catch (err) {
          if (!isInvalidContinuationError(err)) throw err
          yield* runStream()
        }

        if (finalResponseId) {
          yield createFrame('agent-text-complete', {
            text: accumulatedText,
            session: { provider: 'openai', previousResponseId: finalResponseId },
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
