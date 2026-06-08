import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

import type {
  AnthropicModel,
  HistoryEntry,
  LlmProvider,
  OpenAiSession,
  SavedSession,
  AgentSession,
} from '../types'
import { isFileNotFoundError, sessionsDir } from './orb-paths'
import { warn } from './log'

const SESSION_VERSION = 2
const MAX_SESSION_AGE_DAYS = 30
/** Keep at most this many sessions per project; oldest beyond this are pruned. */
const MAX_SESSIONS_PER_PROJECT = 20

function getSessionDir(homeDir = os.homedir()): string {
  return sessionsDir(homeDir)
}

function sanitizeFilename(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-')
  return sanitized || 'project'
}

function hashProjectPath(projectPath: string): string {
  return crypto.createHash('sha256').update(projectPath).digest('hex').slice(0, 12)
}

function projectKey(projectPath: string): string {
  const resolved = path.resolve(projectPath)
  return `${sanitizeFilename(path.basename(resolved))}-${hashProjectPath(resolved)}`
}

/** Directory holding every saved conversation for a project. */
export function getProjectSessionDir(projectPath: string, homeDir = os.homedir()): string {
  return path.join(getSessionDir(homeDir), projectKey(projectPath))
}

/** Path to a single saved conversation, keyed by its stable id. */
export function getSessionFilePath(
  projectPath: string,
  id: string,
  homeDir = os.homedir(),
): string {
  return path.join(getProjectSessionDir(projectPath, homeDir), `${sanitizeFilename(id)}.json`)
}

/** Pre-history layout: one flat file per project. Still read for migration. */
function getLegacySessionPath(projectPath: string, homeDir = os.homedir()): string {
  return path.join(getSessionDir(homeDir), `${projectKey(projectPath)}.json`)
}

/** Exposed for tests that seed a legacy flat-file session. */
export const getLegacyPathForTest = getLegacySessionPath

export interface SessionSummary {
  id: string
  projectPath: string
  projectName: string
  llmProvider: LlmProvider
  llmModel: string
  lastModified: string
  turnCount: number
  preview: string
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
  if (provider === 'anthropic' || provider === 'openai' || provider === 'gemini') return provider
  return undefined
}

function isValidOpenAiSession(value: unknown): value is OpenAiSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<OpenAiSession>
  return (
    session.provider === 'openai' &&
    typeof session.threadId === 'string' &&
    session.threadId.trim().length > 0
  )
}

function normalizeAgentSession(session?: AgentSession): AgentSession | undefined {
  if (!session) return undefined

  switch (session.provider) {
    case 'anthropic':
      return session.sessionId?.length > 0 ? session : undefined
    case 'openai':
      return isValidOpenAiSession(session) ? session : undefined
    default:
      return undefined
  }
}

/**
 * Coerce stored history into well-formed entries. Files are written by Orb, but
 * a corrupt or hand-edited entry (e.g. `{}`) must not crash listing/rendering —
 * downstream code trusts `question`/`answer` to be strings.
 */
function normalizeHistory(history: unknown): HistoryEntry[] {
  if (!Array.isArray(history)) return []
  return history.map((entry) => {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Partial<HistoryEntry>
    return {
      id: typeof e.id === 'string' ? e.id : crypto.randomUUID(),
      question: typeof e.question === 'string' ? e.question : '',
      toolCalls: Array.isArray(e.toolCalls) ? e.toolCalls : [],
      answer: typeof e.answer === 'string' ? e.answer : '',
      error: typeof e.error === 'string' ? e.error : null,
    }
  })
}

/** Coerce a parsed V1/V2 payload into a normalized V2 session, or null. */
function normalizeLoaded(parsed: unknown, resolvedProjectPath: string): SavedSession | null {
  if (isSavedSessionV2(parsed)) {
    if (path.resolve(parsed.projectPath) !== resolvedProjectPath) return null
    return {
      ...parsed,
      id: typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : crypto.randomUUID(),
      llmProvider: normalizeSessionProvider(parsed.llmProvider) ?? 'anthropic',
      agentSession: normalizeAgentSession(parsed.agentSession),
      history: normalizeHistory(parsed.history),
    }
  }

  if (isSavedSessionV1(parsed)) {
    if (path.resolve(parsed.projectPath) !== resolvedProjectPath) return null
    return {
      version: SESSION_VERSION,
      id: crypto.randomUUID(),
      projectPath: parsed.projectPath,
      llmProvider: 'anthropic',
      llmModel: parsed.model,
      agentSession: parsed.sessionId
        ? { provider: 'anthropic', sessionId: parsed.sessionId }
        : undefined,
      lastModified: parsed.lastModified,
      history: normalizeHistory(parsed.history),
    }
  }

  return null
}

async function readSessionFile(
  filePath: string,
  resolvedProjectPath: string,
): Promise<SavedSession | null> {
  try {
    const parsed = (await Bun.file(filePath).json()) as unknown
    return normalizeLoaded(parsed, resolvedProjectPath)
  } catch (err) {
    if (isFileNotFoundError(err)) return null
    warn(`Failed to read session ${filePath}:`, err)
    return null
  }
}

/**
 * Move a pre-history flat session file into the per-project directory so it
 * shows up in listings and resume. Returns the migrated session, or null.
 */
async function migrateLegacySession(
  projectPath: string,
  homeDir: string,
): Promise<SavedSession | null> {
  const resolved = path.resolve(projectPath)
  const legacyPath = getLegacySessionPath(projectPath, homeDir)
  const legacy = await readSessionFile(legacyPath, resolved)
  if (!legacy) return null

  await writeSessionPayload(legacy, homeDir, { refreshLastModified: false })
  await fs.unlink(legacyPath).catch(() => {})
  return legacy
}

/** Root-level pre-history flat files (`<project-key>.json`) beside project dirs. */
async function listLegacyFiles(homeDir: string): Promise<string[]> {
  const sessionDir = getSessionDir(homeDir)
  try {
    const entries = await fs.readdir(sessionDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => path.join(sessionDir, e.name))
  } catch (err) {
    if (isFileNotFoundError(err)) return []
    throw err
  }
}

/**
 * Migrate a single legacy flat file into the per-project layout, keyed by the
 * project path stored inside it. Used by `listSessions` so old sessions from
 * projects the user hasn't reopened still appear in the picker.
 */
async function migrateLegacyFile(legacyPath: string, homeDir: string): Promise<void> {
  let parsed: unknown
  try {
    parsed = (await Bun.file(legacyPath).json()) as unknown
  } catch (err) {
    if (!isFileNotFoundError(err)) warn(`Failed to read session ${legacyPath}:`, err)
    return
  }

  const projectPath =
    parsed && typeof (parsed as SavedSession).projectPath === 'string'
      ? path.resolve((parsed as SavedSession).projectPath)
      : ''
  const session = projectPath ? normalizeLoaded(parsed, projectPath) : null
  if (!session) return

  await writeSessionPayload(session, homeDir, { refreshLastModified: false })
  await fs.unlink(legacyPath).catch(() => {})
}

async function listProjectDirs(homeDir: string): Promise<string[]> {
  const sessionDir = getSessionDir(homeDir)
  try {
    const entries = await fs.readdir(sessionDir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(sessionDir, e.name))
  } catch (err) {
    if (isFileNotFoundError(err)) return []
    throw err
  }
}

/** Load every valid session from a project directory, newest first. */
async function loadProjectSessions(projectDir: string): Promise<SavedSession[]> {
  let filenames: string[]
  try {
    filenames = await fs.readdir(projectDir)
  } catch (err) {
    if (isFileNotFoundError(err)) return []
    throw err
  }

  const sessions = await Promise.all(
    filenames
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const filePath = path.join(projectDir, name)
        try {
          const parsed = (await Bun.file(filePath).json()) as unknown
          const projectPath =
            parsed && typeof (parsed as SavedSession).projectPath === 'string'
              ? path.resolve((parsed as SavedSession).projectPath)
              : ''
          return projectPath ? normalizeLoaded(parsed, projectPath) : null
        } catch {
          return null
        }
      }),
  )

  return sessions
    .filter((s): s is SavedSession => s !== null)
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
}

async function pruneProject(projectDir: string, maxAgeMs: number, keep: number): Promise<void> {
  let filenames: string[]
  try {
    filenames = await fs.readdir(projectDir)
  } catch {
    return
  }

  const files = await Promise.all(
    filenames
      .filter((name) => name.endsWith('.json'))
      .map(async (name) => {
        const filePath = path.join(projectDir, name)
        try {
          const stats = await fs.stat(filePath)
          return stats.isFile() ? { filePath, mtimeMs: stats.mtimeMs } : null
        } catch {
          return null
        }
      }),
  )

  const live = files.filter((f): f is { filePath: string; mtimeMs: number } => f !== null)
  const now = Date.now()
  // Newest first; delete anything stale or beyond the keep-N window.
  live.sort((a, b) => b.mtimeMs - a.mtimeMs)

  await Promise.all(
    live.map(async ({ filePath, mtimeMs }, index) => {
      if (now - mtimeMs > maxAgeMs || index >= keep) {
        await fs.unlink(filePath).catch(() => {})
      }
    }),
  )
}

async function cleanupOldSessions(
  homeDir: string,
  maxAgeDays = MAX_SESSION_AGE_DAYS,
  keepPerProject = MAX_SESSIONS_PER_PROJECT,
): Promise<void> {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  const projectDirs = await listProjectDirs(homeDir)
  await Promise.all(projectDirs.map((dir) => pruneProject(dir, maxAgeMs, keepPerProject)))
}

/** Load the most recently modified saved session for a project. */
export async function loadSession(
  projectPath: string,
  homeDir = os.homedir(),
): Promise<SavedSession | null> {
  const projectDir = getProjectSessionDir(projectPath, homeDir)

  void cleanupOldSessions(homeDir).catch((err) => {
    warn('Failed to clean up old sessions:', err)
  })

  const sessions = await loadProjectSessions(projectDir)
  if (sessions.length > 0) return sessions[0] ?? null

  // Nothing in the new layout — fall back to migrating a legacy flat file.
  return migrateLegacySession(projectPath, homeDir)
}

/** Load a specific saved session by its stable id. */
export async function loadSessionById(
  projectPath: string,
  id: string,
  homeDir = os.homedir(),
): Promise<SavedSession | null> {
  const resolved = path.resolve(projectPath)
  return readSessionFile(getSessionFilePath(projectPath, id, homeDir), resolved)
}

/**
 * List saved sessions, newest first. Pass `projectPath` to scope the listing to
 * a single project (the directory Orb was launched in); omit it to list every
 * project.
 */
export async function listSessions(
  homeDir = os.homedir(),
  projectPath?: string,
): Promise<SessionSummary[]> {
  // Fold pre-history flat files into the per-project layout first so old
  // sessions still show up (and become resumable by id) instead of staying
  // invisible until that project loads. When scoped to one project we only need
  // that project's legacy file, so skip the global scan of every other project.
  let projectDirs: string[]
  if (projectPath) {
    await migrateLegacySession(projectPath, homeDir)
    projectDirs = [getProjectSessionDir(projectPath, homeDir)]
  } else {
    const legacyFiles = await listLegacyFiles(homeDir)
    await Promise.all(legacyFiles.map((file) => migrateLegacyFile(file, homeDir)))
    projectDirs = await listProjectDirs(homeDir)
  }
  const perProject = await Promise.all(projectDirs.map((dir) => loadProjectSessions(dir)))

  const summaries = perProject.flat().map((session): SessionSummary => {
    const firstQuestion = session.history.find((entry) => entry.question.trim().length > 0)
    return {
      id: session.id,
      projectPath: session.projectPath,
      projectName: path.basename(session.projectPath) || session.projectPath,
      llmProvider: session.llmProvider,
      llmModel: session.llmModel,
      lastModified: session.lastModified,
      turnCount: session.history.length,
      preview: firstQuestion?.question.trim() ?? '',
    }
  })

  return summaries.sort((a, b) => b.lastModified.localeCompare(a.lastModified))
}

async function writeSessionPayload(
  session: SavedSession,
  homeDir: string,
  { refreshLastModified }: { refreshLastModified: boolean },
): Promise<void> {
  const resolved = path.resolve(session.projectPath)
  const id = session.id && session.id.length > 0 ? session.id : crypto.randomUUID()
  const sessionPath = getSessionFilePath(resolved, id, homeDir)
  const sessionDir = path.dirname(sessionPath)

  await fs.mkdir(sessionDir, { recursive: true })

  const payload: SavedSession = {
    ...session,
    version: SESSION_VERSION,
    id,
    projectPath: resolved,
    llmProvider: normalizeSessionProvider(session.llmProvider) ?? 'anthropic',
    agentSession: normalizeAgentSession(session.agentSession),
    lastModified: refreshLastModified ? new Date().toISOString() : session.lastModified,
  }

  // A unique suffix keeps concurrent saves of the same session (even within the
  // same process and millisecond) from sharing a temp file and racing on rename.
  const tempPath = `${sessionPath}.${crypto.randomUUID()}.tmp`
  await Bun.write(tempPath, JSON.stringify(payload, null, 2))
  await fs.rename(tempPath, sessionPath)
}

export async function saveSession(session: SavedSession, homeDir = os.homedir()): Promise<void> {
  await writeSessionPayload(session, homeDir, { refreshLastModified: true })
}
