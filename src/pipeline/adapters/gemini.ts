import { ToolLoopAgent, stepCountIs, type ToolSet } from 'ai'
import type { GoogleGenerativeAIModelId } from '@ai-sdk/google'
import { buildProviderPrompt } from '../../services/prompts'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { AgentAdapter, AgentAdapterConfig } from './types'
import { createToolFrameTracker, normalizeToolInput, isToolError, formatToolResult } from './utils'
import { resolveGeminiProvider } from '../../services/gemini-auth'
import { warn } from '../../services/log'
import { createSandbox } from '../sandbox/factory'
import { bash, readFile, writeFile } from '../tools'

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
      const tools = createToolFrameTracker()

      const provider = await resolveGeminiProvider()
      const model = provider(appConfig.llmModel as GoogleGenerativeAIModelId)

      try {
        const agent = new ToolLoopAgent({
          model,
          instructions,
          tools: allowedTools,
          stopWhen: stepCountIs(20),
        })

        const agentStream = await agent.stream({
          prompt,
          experimental_context: { sandbox, signal: abortController.signal },
          abortSignal: abortController.signal,
        })

        for await (const part of agentStream.fullStream) {
          switch (part.type) {
            case 'text-delta':
              accumulatedText += part.text
              yield createFrame('agent-text-delta', { delta: part.text, accumulatedText })
              break

            case 'tool-call':
              yield tools.start({
                id: part.toolCallId,
                name: part.toolName,
                input: normalizeToolInput(part.input),
              })
              break

            case 'tool-result':
              yield* tools.result(
                part.toolCallId,
                formatToolResult(part.output),
                isToolError(part.output),
                part.toolName,
              )
              break

            case 'tool-error':
              yield* tools.result(
                part.toolCallId,
                formatToolResult(part.error),
                true,
                part.toolName,
              )
              break

            case 'error':
              throw part.error instanceof Error ? part.error : new Error(String(part.error))
          }
        }

        yield createFrame('agent-text-complete', {
          text: accumulatedText,
        })
      } finally {
        await sandbox.dispose().catch((err) => {
          warn('sandbox.dispose() failed', err)
        })
      }
    },
  }
}
