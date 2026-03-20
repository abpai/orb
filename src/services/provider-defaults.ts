import { query } from '@anthropic-ai/claude-agent-sdk'
import { DEFAULT_MODEL_BY_PROVIDER } from '../config'
import type { AppConfig, LlmProvider } from '../types'
import { getOpenAiApiKey } from './openai-auth'

type SmartProviderSource = 'claude-oauth' | 'openai-api-key' | 'anthropic-api-key'

type ClaudeAuthState = {
  hasOAuth: boolean
  hasApiKey: boolean
}

const CLAUDE_AUTH_TIMEOUT_MS = 10_000

function getAnthropicApiKey(): string | null {
  return Bun.env.ANTHROPIC_API_KEY || Bun.env.CLAUDE_API_KEY || null
}

// Empty async iterable that immediately completes
const EMPTY_PROMPT: AsyncIterable<never> = {
  [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined as never }) }),
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('timeout'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

async function detectClaudeAuth(config: AppConfig): Promise<ClaudeAuthState> {
  if (!Bun.which('claude')) {
    return { hasOAuth: false, hasApiKey: false }
  }

  const abortController = new AbortController()
  const prompt = EMPTY_PROMPT
  const queryInstance = query({
    prompt,
    options: {
      cwd: config.projectPath,
      model: DEFAULT_MODEL_BY_PROVIDER.anthropic,
      maxTurns: 1,
      persistSession: false,
      permissionMode: 'default',
      abortController,
      stderr: () => {},
    },
  })

  try {
    const info = await withTimeout(queryInstance.accountInfo(), CLAUDE_AUTH_TIMEOUT_MS)
    return {
      hasOAuth: Boolean(info?.tokenSource || info?.subscriptionType),
      hasApiKey: Boolean(info?.apiKeySource),
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[orb] Claude credential detection failed: ${reason}`)
    return { hasOAuth: false, hasApiKey: false }
  } finally {
    abortController.abort()
    await queryInstance.interrupt().catch(() => {})
    if (typeof queryInstance.return === 'function') {
      await queryInstance.return()
    }
  }
}

export async function resolveSmartProvider(
  config: AppConfig,
): Promise<{ provider: LlmProvider; source: SmartProviderSource } | null> {
  const claudeAuth = await detectClaudeAuth(config)

  if (claudeAuth.hasOAuth) {
    return { provider: 'anthropic', source: 'claude-oauth' }
  }

  const openAiApiKey = getOpenAiApiKey(config)
  if (openAiApiKey) {
    return { provider: 'openai', source: 'openai-api-key' }
  }

  const anthropicApiKey = getAnthropicApiKey()
  if (claudeAuth.hasApiKey || anthropicApiKey) {
    return { provider: 'anthropic', source: 'anthropic-api-key' }
  }

  return null
}
