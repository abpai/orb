import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import type { AgentSession } from '../types'
import { isFileNotFoundError } from './orb-paths'
import { listSessions, type SessionSummary } from './session'

/**
 * Discovery of Claude Code and Codex sessions that live OUTSIDE orb's own store,
 * scoped to a project's working directory. orb can already resume these by id
 * (`--claude-session` / `--codex-thread`); this module surfaces them in the
 * picker and looks up a message count for the resume banner.
 *
 * Every listing degrades gracefully — a missing store, absent index, or corrupt
 * line yields fewer rows, never a thrown error.
 */

const CODEX_DEFAULT_MAX_FILES = 2000
const CODEX_DEFAULT_MAX_AGE_DAYS = 30

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

interface CodexRolloutLine {
  type?: string
  payload?: { id?: string; cwd?: string; timestamp?: string; type?: string; message?: string }
}

interface ScannedSession {
  id: string
  messageCount: number
  preview: string
  lastModified: string
}

export interface ExternalSessionMeta {
  messageCount: number
  preview: string
  lastModified: string
}

export interface CodexListResult {
  rows: SessionSummary[]
  capped: boolean
}

/** Runtime-only guard (not a type predicate) so typed field access is preserved. */
function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

// On-disk JSON is untrusted: coerce defensively so a malformed field can never
// throw out of a listing (e.g. `.trim()` on a non-string, `new Date(NaN)`).
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isoFromUnixSecs(value: unknown): string {
  const secs = asFiniteNumber(value)
  if (secs !== undefined) {
    // A finite-but-out-of-range value (e.g. 1e20) makes `toISOString()` throw.
    const date = new Date(secs * 1000)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return new Date(0).toISOString()
}

// ── Claude Code ──────────────────────────────────────────────────────────────

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

/** Parse a Claude Code transcript directly when the index is absent or stale. */
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
    // `JSON.parse('null')` / `'42'` succeed but aren't records — skip them.
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

  // Only top-level `<uuid>.jsonl` files are resumable sessions; subagent
  // transcripts live under `<uuid>/subagents/` and are excluded by readdir
  // (which is non-recursive) and the index filter below.
  const jsonlFiles = new Set(dirEntries.filter((name) => name.endsWith('.jsonl')))
  const index = await readClaudeIndex(dir)
  const rows: SessionSummary[] = []
  const seen = new Set<string>()

  for (const [key, entry] of Object.entries(index?.entries ?? {})) {
    // The index is untrusted JSON — skip malformed (null / non-object) entries.
    if (!isObject(entry)) continue
    if (path.dirname(key) !== dir || !key.endsWith('.jsonl')) continue
    const id = asString(entry.session?.actual_session_id)
    if (!id) continue
    const fileName = `${id}.jsonl`
    // Skip index rows whose file is gone (stale cache).
    if (!jsonlFiles.has(fileName)) continue
    seen.add(fileName)
    rows.push(claudeRowFromIndex(resolvedProject, id, entry))
  }

  // Fall back to scanning any transcript missing from the index.
  for (const fileName of jsonlFiles) {
    if (seen.has(fileName)) continue
    const scanned = await scanClaudeJsonl(path.join(dir, fileName))
    if (scanned) rows.push(claudeRow(resolvedProject, scanned))
  }

  return rows
}

async function lookupClaudeMeta(
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

// ── Codex ────────────────────────────────────────────────────────────────────

async function listSubdirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

function numericDesc(a: string, b: string): number {
  return Number(b) - Number(a)
}

/**
 * Collect candidate Codex rollout paths newest-first, bounded by `maxFiles` and
 * `maxAgeDays`. Date dirs (`YYYY/MM/DD`) are walked descending so the lexical
 * order of rollout filenames (ISO timestamps) is already newest-first.
 */
async function collectCodexCandidates(
  root: string,
  maxFiles: number,
  maxAgeDays: number,
): Promise<{ paths: string[]; capped: boolean }> {
  const paths: string[] = []
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000

  const years = (await listSubdirs(root)).filter((n) => /^\d{4}$/.test(n)).sort(numericDesc)
  for (const year of years) {
    const yearDir = path.join(root, year)
    const months = (await listSubdirs(yearDir)).filter((n) => /^\d{2}$/.test(n)).sort(numericDesc)
    for (const month of months) {
      const monthDir = path.join(yearDir, month)
      const days = (await listSubdirs(monthDir)).filter((n) => /^\d{2}$/.test(n)).sort(numericDesc)
      for (const day of days) {
        // End-of-day timestamp; if even that is older than the cutoff every
        // remaining (descending) day is older too, so stop entirely.
        const dayEndMs = Date.parse(`${year}-${month}-${day}T23:59:59Z`)
        if (Number.isFinite(dayEndMs) && dayEndMs < cutoffMs) {
          return { paths, capped: false }
        }
        const dayDir = path.join(monthDir, day)
        let files: string[]
        try {
          files = await fs.readdir(dayDir)
        } catch {
          continue
        }
        const rollouts = files
          .filter((n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))
          .sort((a, b) => b.localeCompare(a))
        for (const file of rollouts) {
          if (paths.length >= maxFiles) return { paths, capped: true }
          paths.push(path.join(dayDir, file))
        }
      }
    }
  }

  // Legacy pre-date-dir layout: `rollout-*.json` directly under the root.
  try {
    const legacy = (await fs.readdir(root))
      .filter((n) => n.startsWith('rollout-') && n.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a))
    for (const file of legacy) {
      if (paths.length >= maxFiles) return { paths, capped: true }
      paths.push(path.join(root, file))
    }
  } catch {
    // no legacy files
  }

  return { paths, capped: false }
}

/** Read just the first line of a file, stopping the stream once found. */
async function readFirstLine(file: ReturnType<typeof Bun.file>): Promise<string | null> {
  const reader = file.stream().getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) buf += decoder.decode(value, { stream: true })
      const nl = buf.indexOf('\n')
      if (nl !== -1) return buf.slice(0, nl)
      if (done) return buf || null
    }
  } catch {
    return null
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/**
 * Parse a rollout's session_meta (line 1) — read in full however large it is.
 * Returns null unless `id` and `cwd` are present strings, so a syntactically
 * valid but malformed line (e.g. `cwd: {}`) can never reach `path.resolve`.
 */
function parseCodexMeta(firstLine: string): { id: string; cwd: string; timestamp?: string } | null {
  let line: CodexRolloutLine
  try {
    line = JSON.parse(firstLine.trim()) as CodexRolloutLine
  } catch {
    return null
  }
  if (line.type !== 'session_meta') return null
  const id = line.payload?.id
  const cwd = line.payload?.cwd
  if (typeof id !== 'string' || typeof cwd !== 'string') return null
  const timestamp = line.payload?.timestamp
  return { id, cwd, timestamp: typeof timestamp === 'string' ? timestamp : undefined }
}

/**
 * Build a row for a rollout iff its cwd matches the project. The cwd check reads
 * only line 1 (session_meta); only matching rollouts are read in full — the
 * first `user_message` can sit well past 64KB behind large early response
 * items, and matching files are few.
 */
async function readCodexRollout(
  filePath: string,
  resolvedProject: string,
): Promise<SessionSummary | null> {
  const file = Bun.file(filePath)

  const firstLine = await readFirstLine(file)
  if (!firstLine) return null
  const meta = parseCodexMeta(firstLine)
  if (!meta?.id || !meta.cwd || path.resolve(meta.cwd) !== resolvedProject) return null

  let text: string
  try {
    text = await file.text()
  } catch {
    text = firstLine
  }

  let preview = ''
  let userCount = 0
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    let line: CodexRolloutLine
    try {
      line = JSON.parse(trimmed) as CodexRolloutLine
    } catch {
      continue
    }
    if (line.type === 'event_msg' && line.payload?.type === 'user_message') {
      userCount++
      if (!preview && typeof line.payload.message === 'string') {
        preview = line.payload.message.trim()
      }
    }
  }

  return {
    id: meta.id,
    projectPath: resolvedProject,
    projectName: path.basename(resolvedProject) || resolvedProject,
    llmProvider: 'openai',
    llmModel: '',
    lastModified: meta.timestamp ?? new Date(0).toISOString(),
    turnCount: userCount,
    preview,
    source: 'codex',
  }
}

/** List this project's Codex sessions via a bounded newest-first scan. */
export async function listCodexSessions(
  projectPath: string,
  homeDir = os.homedir(),
  opts: { maxFiles?: number; maxAgeDays?: number } = {},
): Promise<CodexListResult> {
  const maxFiles = opts.maxFiles ?? CODEX_DEFAULT_MAX_FILES
  const maxAgeDays = opts.maxAgeDays ?? CODEX_DEFAULT_MAX_AGE_DAYS
  const root = path.join(homeDir, '.codex', 'sessions')
  const resolvedProject = path.resolve(projectPath)

  const { paths, capped } = await collectCodexCandidates(root, maxFiles, maxAgeDays)
  const rows: SessionSummary[] = []
  for (const filePath of paths) {
    try {
      const row = await readCodexRollout(filePath, resolvedProject)
      if (row) rows.push(row)
    } catch {
      // One corrupt rollout must not abort the whole listing.
    }
  }
  return { rows, capped }
}

async function lookupCodexMeta(
  threadId: string,
  projectPath: string,
  homeDir: string,
): Promise<ExternalSessionMeta | null> {
  const root = path.join(homeDir, '.codex', 'sessions')
  const resolvedProject = path.resolve(projectPath)
  const { paths } = await collectCodexCandidates(
    root,
    CODEX_DEFAULT_MAX_FILES,
    CODEX_DEFAULT_MAX_AGE_DAYS,
  )

  for (const filePath of paths) {
    // The threadId is the uuid embedded in the filename — cheap pre-filter.
    if (!filePath.includes(threadId)) continue
    try {
      const row = await readCodexRollout(filePath, resolvedProject)
      if (row && row.id === threadId) {
        return { messageCount: row.turnCount, preview: row.preview, lastModified: row.lastModified }
      }
    } catch {
      // Skip an unreadable rollout and keep looking.
    }
  }
  return null
}

// ── Combined ───────────────────────────────────────────────────────────────

/** orb + Claude Code + Codex sessions for a project, merged newest-first. */
export async function listAllSessions(
  projectPath: string,
  homeDir = os.homedir(),
): Promise<{ sessions: SessionSummary[]; codexCapped: boolean }> {
  const [orb, claude, codex] = await Promise.all([
    listSessions(homeDir, projectPath),
    listClaudeSessions(projectPath, homeDir),
    listCodexSessions(projectPath, homeDir),
  ])
  const sessions = [...orb, ...claude, ...codex.rows].sort((a, b) =>
    b.lastModified.localeCompare(a.lastModified),
  )
  return { sessions, codexCapped: codex.capped }
}

/**
 * Message count + preview for an external session being resumed, used to tell
 * the user how much hidden history the model still has. Null when the session
 * can't be located (resume still works; the banner just omits the count).
 */
export async function lookupExternalSessionMeta(
  session: AgentSession,
  projectPath: string,
  homeDir = os.homedir(),
): Promise<ExternalSessionMeta | null> {
  if (session.provider === 'anthropic') {
    return lookupClaudeMeta(session.sessionId, projectPath, homeDir)
  }
  return lookupCodexMeta(session.threadId, projectPath, homeDir)
}
