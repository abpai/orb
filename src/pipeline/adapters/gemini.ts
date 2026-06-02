import { ToolLoopAgent, stepCountIs, type ToolSet, type StepResult } from 'ai'
import { buildProviderPrompt } from '../../services/prompts'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { AgentAdapter, AgentAdapterConfig } from './types'
import { normalizeToolInput, isToolError, formatToolResult } from './utils'
import { resolveGeminiProvider } from '../../services/gemini-auth'
import { createSandbox } from '../sandbox/factory'
import { bash, readFile, writeFile } from '../tools'

interface GeminiToolCall {
  toolCallId: string
  toolName: string
  input: unknown
}

interface GeminiToolResult {
  toolCallId: string
  toolName: string
  output: unknown
}

export function createGeminiAdapter(config: AgentAdapterConfig): AgentAdapter {
  return {
    async *stream(prompt: string): AsyncIterable<Frame> {
      const { appConfig, abortController } = config
      const instructions = await buildProviderPrompt({
        provider: 'gemini',
        projectPath: appConfig.projectPath,
        ttsEnabled: appConfig.ttsEnabled,
      })

      const sandbox = createSandbox({ rootDir: appConfig.projectPath, yolo: appConfig.yolo })
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

      function registerToolCall(call: GeminiToolCall): void {
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

      function registerToolResult(result: GeminiToolResult): void {
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

      const provider = await resolveGeminiProvider()
      const model = provider(appConfig.llmModel as never)

      try {
        const agent = new ToolLoopAgent({
          model,
          instructions,
          tools: allowedTools,
          stopWhen: stepCountIs(20),
        })

        const streamArgs = {
          prompt,
          experimental_context: { sandbox, signal: abortController.signal },
          onStepFinish: (stepResult: StepResult<ToolSet>) => {
            for (const call of stepResult.toolCalls) {
              registerToolCall(call)
            }
            for (const result of stepResult.toolResults) {
              registerToolResult(result)
            }
          },
          abortSignal: abortController.signal,
        } as Parameters<typeof agent.stream>[0]

        const agentStream = await agent.stream(streamArgs)

        for await (const chunk of agentStream.textStream) {
          while (pendingFrames.length > 0) {
            yield pendingFrames.shift()!
          }

          accumulatedText += chunk
          yield createFrame('agent-text-delta', {
            delta: chunk,
            accumulatedText,
          })
        }

        while (pendingFrames.length > 0) {
          yield pendingFrames.shift()!
        }

        yield createFrame('agent-text-complete', {
          text: accumulatedText,
        })
      } finally {
        await sandbox.dispose().catch((err) => {
          console.warn('sandbox.dispose() failed', err)
        })
      }
    },
  }
}
