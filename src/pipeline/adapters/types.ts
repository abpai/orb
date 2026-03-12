import type { Frame } from '../frames'
import type { AgentSession, AppConfig } from '../../types'

/**
 * Normalized interface for agent providers.
 * Each adapter wraps a provider SDK and yields frames instead of calling callbacks.
 */
export interface AgentAdapter {
  stream(prompt: string): AsyncIterable<Frame>
}

export interface AgentAdapterConfig {
  appConfig: AppConfig
  session: AgentSession | undefined
  abortController: AbortController
}
