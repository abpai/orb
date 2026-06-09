import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { isFileNotFoundError } from '../orb-paths'
import type { SessionSummary } from '../session'
import type { ExternalSessionMeta } from './types'

interface ClaudeIndexEntry {
  modified_time?: number
  first_user_content?: string
  session?: {
    actual_session_id?: string
    message_count?: number
    last_message_time?: string
    summary?: string
  }
}

interface ClaudeIndex {
  entries?: Record<string, ClaudeIndexEntry>
}

interface ClaudeJsonlLine {
  type?: string
  sessionId?: string
  message?: { content?: unknown }
}

interface ScannedSession {
  id: string
  messageCount: number
  preview: string
  lastModified: string
}

function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isoFromUnixSecs(value: unknown): string {
  const secs = asFiniteNumber(value)
  if (secs !== undefined) {
    const date = new Date(secs * 1000)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return new Date(0).toISOString()
}

/**
 * Encode an absolute cwd into Claude Code's project-dir name: every `/` and `.`
 * becomes `-` (e.g. `/Users/x/.codex/y` → `-Users-x--codex-y`).
 */
export function encodeClaudeProjectDir(projectPath: string): string {
  return path.resolve(projectPath).replace(/[/.]/g, '-')
}

/** `~/.claude/projects/<encoded-cwd>` for a project. */
export function claudeProjectDir(projectPath: string, homeDir = os.homedir()): string {
  return path.join(homeDir, '.claude', 'projects', encodeClaudeProjectDir(projectPath))
}

async function readClaudeIndex(dir: string): Promise<ClaudeIndex | null> {
  try {
    const raw = await Bun.file(path.join(dir, '.session_cache.json')).text()
    return JSON.parse(raw) as ClaudeIndex
  } catch {
    return null
  }
}

function extractClaudeUserText(line: ClaudeJsonlLine): string {
  const content = line.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    for (const block of content) {
      const text = (block as { type?: string; text?: unknown } | null)?.text
      if ((block as { type?: string } | null)?.type === 'text' && typeof text === 'string') {
        return text.trim()
      }
    }
  }
  return ''
}

async function scanClaudeJsonl(filePath: string): Promise<ScannedSession | null> {
  let text: string
  let mtimeMs: number
  try {
    const [content, stat] = await Promise.all([Bun.file(filePath).text(), fs.stat(filePath)])
    text = content
    mtimeMs = stat.mtimeMs
  } catch {
    return null
  }

  let id: string | undefined
  let preview = ''
  let userCount = 0
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    let line: ClaudeJsonlLine
    try {
      line = JSON.parse(trimmed) as ClaudeJsonlLine
    } catch {
      continue
    }
    if (!isObject(line)) continue
    if (!id && typeof line.sessionId === 'string') id = line.sessionId
    if (line.type === 'user') {
      userCount++
      if (!preview) preview = extractClaudeUserText(line)
    }
  }

  return {
    id: id ?? path.basename(filePath, '.jsonl'),
    messageCount: userCount,
    preview,
    lastModified: new Date(mtimeMs).toISOString(),
  }
}

function claudeRow(projectPath: string, scanned: ScannedSession): SessionSummary {
  return {
    id: scanned.id,
    projectPath,
    projectName: path.basename(projectPath) || projectPath,
    llmProvider: 'anthropic',
    llmModel: '',
    lastModified: scanned.lastModified,
    turnCount: scanned.messageCount,
    preview: scanned.preview,
    source: 'claude',
  }
}

function claudeRowFromIndex(
  projectPath: string,
  id: string,
  entry: ClaudeIndexEntry,
): SessionSummary {
  return {
    id,
    projectPath,
    projectName: path.basename(projectPath) || projectPath,
    llmProvider: 'anthropic',
    llmModel: '',
    lastModified:
      asString(entry.session?.last_message_time) ?? isoFromUnixSecs(entry.modified_time),
    turnCount: asFiniteNumber(entry.session?.message_count) ?? 0,
    preview: (asString(entry.first_user_content) ?? asString(entry.session?.summary) ?? '').trim(),
    source: 'claude',
  }
}

/** List this project's Claude Code sessions, newest data preferred via the index. */
export async function listClaudeSessions(
  projectPath: string,
  homeDir = os.homedir(),
): Promise<SessionSummary[]> {
  const dir = claudeProjectDir(projectPath, homeDir)
  const resolvedProject = path.resolve(projectPath)

  let dirEntries: string[]
  try {
    dirEntries = await fs.readdir(dir)
  } catch (err) {
    if (isFileNotFoundError(err)) return []
    return []
  }

  const jsonlFiles = new Set(dirEntries.filter((name) => name.endsWith('.jsonl')))
  const index = await readClaudeIndex(dir)
  const rows: SessionSummary[] = []
  const seen = new Set<string>()

  for (const [key, entry] of Object.entries(index?.entries ?? {})) {
    if (!isObject(entry)) continue
    if (path.dirname(key) !== dir || !key.endsWith('.jsonl')) continue
    const id = asString(entry.session?.actual_session_id)
    if (!id) continue
    const fileName = `${id}.jsonl`
    if (!jsonlFiles.has(fileName)) continue
    seen.add(fileName)
    rows.push(claudeRowFromIndex(resolvedProject, id, entry))
  }

  for (const fileName of jsonlFiles) {
    if (seen.has(fileName)) continue
    const scanned = await scanClaudeJsonl(path.join(dir, fileName))
    if (scanned) rows.push(claudeRow(resolvedProject, scanned))
  }

  return rows
}

export async function lookupClaudeMeta(
  sessionId: string,
  projectPath: string,
  homeDir: string,
): Promise<ExternalSessionMeta | null> {
  const dir = claudeProjectDir(projectPath, homeDir)
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  const index = await readClaudeIndex(dir)
  const byPath = index?.entries?.[filePath]
  const entry =
    (isObject(byPath) ? byPath : undefined) ??
    Object.values(index?.entries ?? {}).find(
      (e) => isObject(e) && asString(e.session?.actual_session_id) === sessionId,
    )

  if (entry) {
    const messageCount = asFiniteNumber(entry.session?.message_count) ?? 0
    const preview = (asString(entry.first_user_content) ?? '').trim()
    if (messageCount > 0 || preview) {
      return {
        messageCount,
        preview,
        lastModified:
          asString(entry.session?.last_message_time) ?? isoFromUnixSecs(entry.modified_time),
      }
    }
  }

  const scanned = await scanClaudeJsonl(filePath)
  if (!scanned) return null
  return {
    messageCount: scanned.messageCount,
    preview: scanned.preview,
    lastModified: scanned.lastModified,
  }
}
