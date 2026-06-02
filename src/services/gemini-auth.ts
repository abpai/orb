import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from '@ai-sdk/google'
import type { AppConfig } from '../types'

export type GeminiAuthSource = 'api-key'

export function getGeminiApiKey(config: AppConfig): string | null {
  return config.geminiApiKey || Bun.env.GOOGLE_GENERATIVE_AI_API_KEY || null
}

export async function resolveGeminiProvider(
  config: AppConfig,
): Promise<{ provider: GoogleGenerativeAIProvider; source: GeminiAuthSource }> {
  const apiKey = getGeminiApiKey(config)
  if (apiKey) {
    return { provider: createGoogleGenerativeAI({ apiKey }), source: 'api-key' }
  }

  throw new Error('Gemini requires GOOGLE_GENERATIVE_AI_API_KEY for Orb.')
}
