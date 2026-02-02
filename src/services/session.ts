import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

import type { AgentSession, AnthropicModel, LlmProvider, SavedSession } from '../types'

const SESSION_VERSION = 2
const SESSION_DIR = path.join('.orb', 'sessions')
const MAX_SESSION_AGE_DAYS = 30

function isFileNotFoundError(err: unknown): boolean {
  return (err as { code?: string })?.code === 'ENOENT'
}

function getSessionDir(): string {
  return path.join(os.homedir(), SESSION_DIR)
}

function sanitizeFilename(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-')
  return sanitized || 'project'
}

function hashProjectPath(projectPath: string): string {
  return crypto.createHash('sha256').update(projectPath).digest('hex').slice(0, 12)
}

export function getSessionPath(projectPath: string): string {
  const resolved = path.resolve(projectPath)
  const base = sanitizeFilename(path.basename(resolved))
  const hash = hashProjectPath(resolved)
  return path.join(getSessionDir(), `${base}-${hash}.json`)
}

interface SavedSessionV1 {
  version: 1
  projectPath: string
  sessionId: string
  model: AnthropicModel
  lastModified: string
  history: SavedSession['history']
}

function isSavedSessionV1(value: unknown): value is SavedSessionV1 {
  if (!value || typeof value !== 'object') return false
  const session = value as SavedSessionV1
  return (
    session.version === 1 &&
    typeof session.projectPath === 'string' &&
    typeof session.sessionId === 'string' &&
    typeof session.model === 'string' &&
    typeof session.lastModified === 'string' &&
    Array.isArray(session.history)
  )
}

function isSavedSessionV2(value: unknown): value is SavedSession {
  if (!value || typeof value !== 'object') return false
  const session = value as SavedSession
  return (
    session.version === SESSION_VERSION &&
    typeof session.projectPath === 'string' &&
    typeof session.llmProvider === 'string' &&
    typeof session.llmModel === 'string' &&
    typeof session.lastModified === 'string' &&
    Array.isArray(session.history)
  )
}

function normalizeSessionProvider(provider: string): LlmProvider | undefined {
  if (provider === 'anthropic' || provider === 'openai') return provider
  return undefined
}

function isValidOpenAiMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== 'object') return false
  const typed = msg as { role?: string; content?: string }
  const hasValidRole = typed.role === 'user' || typed.role === 'assistant'
  const hasValidContent = typeof typed.content === 'string' && typed.content.length > 0
  return hasValidRole && hasValidContent
}

function normalizeAgentSession(session?: AgentSession): AgentSession | undefined {
  if (!session) return undefined

  switch (session.provider) {
    case 'anthropic':
      return session.sessionId?.length > 0 ? session : undefined
    case 'openai':
      return Array.isArray(session.messages) && session.messages.every(isValidOpenAiMessage)
        ? session
        : undefined
    default:
      return undefined
  }
}

export async function cleanupOldSessions(maxAgeDays = MAX_SESSION_AGE_DAYS): Promise<void> {
  const sessionDir = getSessionDir()
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000

  let filenames: string[]
  try {
    filenames = await fs.readdir(sessionDir)
  } catch (err) {
    if (isFileNotFoundError(err)) return
    throw err
  }

  const now = Date.now()

  await Promise.all(
    filenames
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const filePath = path.join(sessionDir, name)
        try {
          const stats = await fs.stat(filePath)
          if (stats.isFile() && now - stats.mtimeMs > maxAgeMs) {
            await fs.unlink(filePath)
          }
        } catch {
          // Ignore errors for individual files
        }
      }),
  )
}

export async function loadSession(projectPath: string): Promise<SavedSession | null> {
  const resolved = path.resolve(projectPath)
  const sessionPath = getSessionPath(resolved)
  const sessionFile = Bun.file(sessionPath)

  void cleanupOldSessions().catch((err) => {
    console.warn('Failed to clean up old sessions:', err)
  })

  try {
    if (!(await sessionFile.exists())) return null
    const parsed = (await sessionFile.json()) as unknown
    if (isSavedSessionV2(parsed)) {
      if (path.resolve(parsed.projectPath) !== resolved) {
        return null
      }
      return {
        ...parsed,
        llmProvider: normalizeSessionProvider(parsed.llmProvider) ?? 'anthropic',
        agentSession: normalizeAgentSession(parsed.agentSession),
      }
    }

    if (isSavedSessionV1(parsed)) {
      if (path.resolve(parsed.projectPath) !== resolved) {
        return null
      }
      const migrated: SavedSession = {
        version: SESSION_VERSION,
        projectPath: parsed.projectPath,
        llmProvider: 'anthropic',
        llmModel: parsed.model,
        agentSession: parsed.sessionId
          ? { provider: 'anthropic', sessionId: parsed.sessionId }
          : undefined,
        lastModified: parsed.lastModified,
        history: parsed.history,
      }
      return migrated
    }

    console.warn('Invalid session format, starting fresh.')
    return null
  } catch (err) {
    if (isFileNotFoundError(err)) return null
    console.warn('Failed to load session, starting fresh:', err)
    return null
  }
}

export async function saveSession(session: SavedSession): Promise<void> {
  const resolved = path.resolve(session.projectPath)
  const sessionPath = getSessionPath(resolved)
  const sessionDir = path.dirname(sessionPath)

  await fs.mkdir(sessionDir, { recursive: true })

  const payload: SavedSession = {
    ...session,
    version: SESSION_VERSION,
    projectPath: resolved,
    llmProvider: normalizeSessionProvider(session.llmProvider) ?? 'anthropic',
    agentSession: normalizeAgentSession(session.agentSession),
    lastModified: new Date().toISOString(),
  }

  const tempPath = `${sessionPath}.${process.pid}.${Date.now()}.tmp`
  await Bun.write(tempPath, JSON.stringify(payload, null, 2))
  await fs.rename(tempPath, sessionPath)
}
