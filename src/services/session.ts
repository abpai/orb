import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

import type { SavedSession } from '../types'

const SESSION_VERSION = 1
const SESSION_DIR = path.join('.vibe-claude', 'sessions')
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

function isSavedSession(value: unknown): value is SavedSession {
  if (!value || typeof value !== 'object') return false
  const session = value as SavedSession
  return (
    session.version === SESSION_VERSION &&
    typeof session.projectPath === 'string' &&
    typeof session.sessionId === 'string' &&
    typeof session.model === 'string' &&
    typeof session.lastModified === 'string' &&
    Array.isArray(session.history)
  )
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

  void cleanupOldSessions().catch((err) => {
    console.warn('Failed to clean up old sessions:', err)
  })

  try {
    const raw = await fs.readFile(sessionPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!isSavedSession(parsed)) {
      console.warn('Invalid session format, starting fresh.')
      return null
    }

    if (path.resolve(parsed.projectPath) !== resolved) {
      return null
    }

    return parsed
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
    lastModified: new Date().toISOString(),
  }

  const tempPath = `${sessionPath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8')
  await fs.rename(tempPath, sessionPath)
}
