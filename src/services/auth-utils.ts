import { Buffer } from 'node:buffer'

export interface CodexTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp in ms
  accountId?: string
}

const TOKEN_KEYS = [
  'access_token',
  'accessToken',
  'token',
  'id_token',
  'idToken',
  'session_token',
  'sessionToken',
]

export function findToken(value: unknown): string | null {
  if (!value) return null

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || null
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findToken(entry)
      if (found) return found
    }
    return null
  }

  if (typeof value !== 'object') return null

  const record = value as Record<string, unknown>

  // Check well-known token keys first
  for (const key of TOKEN_KEYS) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  // Search recursively through all keys
  for (const [key, candidate] of Object.entries(record)) {
    if (!candidate) continue

    if (key.toLowerCase().includes('token') && typeof candidate === 'string') {
      const trimmed = candidate.trim()
      if (trimmed) return trimmed
    }

    const found = findToken(candidate)
    if (found) return found
  }

  return null
}

export async function readJsonFile(path: string): Promise<unknown | null> {
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    return (await file.json()) as unknown
  } catch {
    return null
  }
}

export function extractAccountId(tokens: {
  id_token?: string
  access_token?: string
}): string | undefined {
  const token = tokens.id_token || tokens.access_token
  if (!token) return undefined

  const parts = token.split('.')
  if (parts.length !== 3) return undefined

  const payloadPart = parts[1]
  if (!payloadPart) return undefined

  try {
    const payload = Buffer.from(payloadPart, 'base64url').toString('utf8')
    const claims = JSON.parse(payload) as Record<string, unknown>

    // Check known locations for account ID
    if (typeof claims.chatgpt_account_id === 'string') {
      return claims.chatgpt_account_id
    }

    const auth = claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined
    if (auth && typeof auth.chatgpt_account_id === 'string') {
      return auth.chatgpt_account_id
    }

    const orgs = claims.organizations as Array<{ id?: string }> | undefined
    if (Array.isArray(orgs) && orgs[0]?.id) {
      return orgs[0].id
    }
  } catch {
    return undefined
  }

  return undefined
}

export function parseCodexAuthFile(data: unknown): CodexTokens | null {
  if (!data || typeof data !== 'object') return null

  const record = data as Record<string, unknown>
  const tokens = record.tokens as Record<string, string> | undefined

  if (!tokens || typeof tokens !== 'object') return null

  const accessToken = tokens.access_token
  const refreshToken = tokens.refresh_token

  if (typeof accessToken !== 'string' || !accessToken.trim()) return null
  if (typeof refreshToken !== 'string' || !refreshToken.trim()) return null

  // Parse last_refresh to estimate expiry (tokens typically last 1 hour)
  let expiresAt: number
  const lastRefresh = record.last_refresh
  if (typeof lastRefresh === 'string') {
    const refreshTime = new Date(lastRefresh).getTime()
    // Assume 1 hour expiry from last refresh
    expiresAt = refreshTime + 3600 * 1000
  } else {
    // If no last_refresh, assume token expires in 5 minutes (forces refresh check)
    expiresAt = Date.now() + 5 * 60 * 1000
  }

  return {
    accessToken: accessToken.trim(),
    refreshToken: refreshToken.trim(),
    expiresAt,
    accountId: extractAccountId(tokens),
  }
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2)
  await Bun.write(filePath, json)
}
