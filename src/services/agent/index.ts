import type { AgentSession, AppConfig } from '../../types'
import { runAnthropicAgent } from './anthropic'
import { runOpenAiAgent } from './openai'
import type { AgentCallbacks, AgentRunResult } from './types'

export type { AgentCallbacks, AgentRunResult } from './types'

export async function runAgent(
  prompt: string,
  config: AppConfig,
  session: AgentSession | undefined,
  callbacks: AgentCallbacks,
  abortController?: AbortController,
): Promise<AgentRunResult> {
  if (config.llmProvider === 'openai') {
    return runOpenAiAgent(prompt, config, session, callbacks, abortController)
  }
  return runAnthropicAgent(prompt, config, session, callbacks, abortController)
}
