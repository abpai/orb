import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai'
import type { AppConfig } from '../types'
export type AuthSource = 'api-key'

export function getOpenAiApiKey(config: AppConfig): string | null {
  return config.openaiApiKey || Bun.env.OPENAI_API_KEY || null
}

export async function resolveOpenAiProvider(
  config: AppConfig,
): Promise<{ provider: OpenAIProvider; source: AuthSource }> {
  const apiKey = getOpenAiApiKey(config)
  if (apiKey) {
    return { provider: createOpenAI({ apiKey }), source: 'api-key' }
  }

  throw new Error('OpenAI requires OPENAI_API_KEY for Orb.')
}
