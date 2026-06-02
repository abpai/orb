import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from '@ai-sdk/google'

export function getGeminiApiKey(): string | null {
  return Bun.env.GOOGLE_GENERATIVE_AI_API_KEY || null
}

export async function resolveGeminiProvider(): Promise<GoogleGenerativeAIProvider> {
  const apiKey = getGeminiApiKey()
  if (apiKey) {
    return createGoogleGenerativeAI({ apiKey })
  }

  throw new Error('Gemini requires GOOGLE_GENERATIVE_AI_API_KEY for Orb.')
}
