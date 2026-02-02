import os from 'node:os'
import path from 'node:path'
import { URL } from 'node:url'

import { createOpenAI, openai, type OpenAIProvider } from '@ai-sdk/openai'
import type { AppConfig } from '../types'
import {
  type CodexTokens,
  extractAccountId,
  findToken,
  parseCodexAuthFile,
  readJsonFile,
  writeJsonFile,
} from './auth-utils'

export type AuthSource = 'api-key' | 'chatgpt' | 'none'

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const ISSUER = 'https://auth.openai.com'
const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api'

const CODEX_ALLOWED_MODELS = new Set(['gpt-5.2', 'gpt-5.2-codex'])

let loginPromise: Promise<void> | null = null

function getCodexHome(): string {
  return Bun.env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

export async function readOpenAiOAuthToken(): Promise<string | null> {
  const authPath = path.join(getCodexHome(), 'auth.json')
  const parsed = await readJsonFile(authPath)
  return findToken(parsed)
}

async function runCodexLogin(deviceAuth: boolean): Promise<void> {
  const cmd = ['codex', 'login']
  if (deviceAuth) cmd.push('--device-auth')

  let proc: Bun.Subprocess
  try {
    proc = Bun.spawn(cmd, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  } catch (err) {
    const error = err as Error & { code?: string }
    if (error.code === 'ENOENT') {
      throw new Error(
        'codex CLI not found. Install @openai/codex or set OPENAI_API_KEY to use OpenAI.',
      )
    }
    throw err
  }

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`codex login failed with exit code ${exitCode ?? 'unknown'}`)
  }
}

async function ensureCodexLogin(config: AppConfig): Promise<void> {
  if (!config.openaiLogin && !config.openaiDeviceLogin) return
  if (!loginPromise) {
    const useDeviceAuth = config.openaiDeviceLogin
    loginPromise = runCodexLogin(useDeviceAuth)
  }
  await loginPromise
}

export function getOpenAiApiKey(config: AppConfig): string | null {
  return config.openaiApiKey || Bun.env.OPENAI_API_KEY || null
}

export function validateCodexModel(model: string): void {
  if (!CODEX_ALLOWED_MODELS.has(model)) {
    const allowed = Array.from(CODEX_ALLOWED_MODELS).join(', ')
    throw new Error(
      `Model "${model}" is not available with ChatGPT OAuth. Available models: ${allowed}. Use OPENAI_API_KEY for other models.`,
    )
  }
}

async function readCodexTokens(): Promise<CodexTokens | null> {
  const authPath = path.join(getCodexHome(), 'auth.json')
  const parsed = await readJsonFile(authPath)
  return parseCodexAuthFile(parsed)
}

async function saveCodexTokens(tokens: CodexTokens): Promise<void> {
  const authPath = path.join(getCodexHome(), 'auth.json')

  // Read existing file to preserve structure
  const existing = (await readJsonFile(authPath)) as Record<string, unknown> | null

  const existingTokens = existing?.tokens as Record<string, string> | undefined

  const updated = {
    ...existing,
    tokens: {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      // Preserve id_token if it exists
      ...(existingTokens?.id_token ? { id_token: existingTokens.id_token } : {}),
    },
    last_refresh: new Date().toISOString(),
  }

  await writeJsonFile(authPath, updated)
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  id_token?: string
  expires_in?: number
}

async function refreshCodexToken(refreshToken: string): Promise<CodexTokens> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Token refresh failed: ${response.status} ${text}`)
  }

  const data = (await response.json()) as TokenResponse
  const expiresIn = data.expires_in ?? 3600

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    accountId: extractAccountId(data),
  }
}

function rewriteCodexUrl(input: string | URL | Request): string | URL | Request {
  // The AI SDK sends requests to baseURL + /v1/responses or /v1/chat/completions
  // The Codex endpoint expects /codex/responses instead
  const getUrl = (i: string | URL | Request): string => {
    if (typeof i === 'string') return i
    if (i instanceof URL) return i.href
    return i.url
  }

  const url = getUrl(input)

  // Rewrite /v1/responses to /codex/responses
  // Rewrite /v1/chat/completions to /codex/chat/completions (if needed)
  const rewritten = url
    .replace('/v1/responses', '/codex/responses')
    .replace('/v1/chat/completions', '/codex/chat/completions')

  if (url === rewritten) return input

  if (typeof input === 'string') return rewritten
  if (input instanceof URL) return new URL(rewritten)

  // For Request objects, create a new one with the rewritten URL
  return new Request(rewritten, input)
}

function createCodexFetch(initialTokens: CodexTokens): typeof fetch {
  let tokens = initialTokens
  const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000 // Refresh 5 minutes before expiry

  const customFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    // Rewrite URL for Codex endpoint
    const rewrittenInput = rewriteCodexUrl(input)

    // Proactively refresh if token is close to expiry
    if (tokens.expiresAt < Date.now() + TOKEN_REFRESH_BUFFER_MS) {
      try {
        tokens = await refreshCodexToken(tokens.refreshToken)
        await saveCodexTokens(tokens)
      } catch {
        // Continue with existing token, let request fail if truly expired
      }
    }

    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${tokens.accessToken}`)
    if (tokens.accountId) {
      headers.set('ChatGPT-Account-Id', tokens.accountId)
    }
    headers.set('originator', 'orb')

    const response = await fetch(rewrittenInput, { ...init, headers })

    // Handle 401 with refresh retry
    if (response.status === 401 && tokens.refreshToken) {
      try {
        tokens = await refreshCodexToken(tokens.refreshToken)
        await saveCodexTokens(tokens)
        headers.set('Authorization', `Bearer ${tokens.accessToken}`)
        if (tokens.accountId) {
          headers.set('ChatGPT-Account-Id', tokens.accountId)
        }
        return fetch(rewrittenInput, { ...init, headers })
      } catch {
        // Refresh failed, return original 401 response
      }
    }

    return response
  }

  // Cast to typeof fetch - the AI SDK only uses the callable portion
  return customFetch as typeof fetch
}

export async function resolveOpenAiProvider(
  config: AppConfig,
): Promise<{ provider: OpenAIProvider; source: AuthSource }> {
  // API key takes precedence over OAuth (allows bypassing model restrictions)
  const apiKey = getOpenAiApiKey(config)
  if (apiKey) {
    return { provider: createOpenAI({ apiKey }), source: 'api-key' }
  }

  await ensureCodexLogin(config)

  const codexTokens = await readCodexTokens()
  if (codexTokens) {
    // Use Codex OAuth with custom endpoint
    const codexFetch = createCodexFetch(codexTokens)

    return {
      provider: createOpenAI({
        apiKey: 'codex-oauth', // Dummy key, custom fetch handles auth
        baseURL: CODEX_API_ENDPOINT,
        fetch: codexFetch,
      }),
      source: 'chatgpt',
    }
  }

  if (config.openaiLogin || config.openaiDeviceLogin) {
    throw new Error(
      'OpenAI login requested but no auth token was found. Run `codex login` or set OPENAI_API_KEY.',
    )
  }

  return { provider: openai, source: 'none' }
}
