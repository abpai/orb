import type { LlmProvider } from '../../types'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { Processor } from '../processor'
import type { AgentAdapter, AgentAdapterConfig } from '../adapters/types'
import { createAnthropicAdapter } from '../adapters/anthropic'
import { createOpenAiAdapter } from '../adapters/openai'
import { createGeminiAdapter } from '../adapters/gemini'
import { isAbortError } from '../adapters/utils'

/**
 * Provider → adapter factory. A Record keyed by LlmProvider gives compile-time
 * exhaustiveness: adding a provider to the union forces a new entry here.
 */
const ADAPTER_FACTORIES: Record<LlmProvider, (config: AgentAdapterConfig) => AgentAdapter> = {
  anthropic: createAnthropicAdapter,
  openai: createOpenAiAdapter,
  gemini: createGeminiAdapter,
}

/**
 * AgentProcessor: receives UserTextFrame, dispatches to the appropriate adapter,
 * and yields agent frames (text deltas, tool calls, completion).
 * All other frames pass through unchanged.
 */
export function createAgentProcessor(adapterConfig: AgentAdapterConfig): Processor {
  return async function* agentProcessor(upstream: AsyncIterable<Frame>): AsyncGenerator<Frame> {
    for await (const frame of upstream) {
      if (frame.kind !== 'user-text') {
        yield frame
        continue
      }

      const adapter = ADAPTER_FACTORIES[adapterConfig.appConfig.llmProvider](adapterConfig)

      try {
        yield* adapter.stream(frame.text)
      } catch (err) {
        if (!isAbortError(err)) {
          yield createFrame('agent-error', {
            error: err instanceof Error ? err : new Error(String(err)),
          })
        }
      }
    }
  }
}
