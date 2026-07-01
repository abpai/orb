import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import type { SessionSummary } from '../session'
import { asString } from './coerce'
import type { CodexListResult, ExternalSessionMeta } from './types'

const CODEX_DEFAULT_MAX_FILES = 2000
const CODEX_DEFAULT_MAX_AGE_DAYS = 30
const CODEX_READ_CONCURRENCY = 4

interface CodexRolloutLine {
  type?: string
  payload?: {
    id?: string
    cwd?: string
    timestamp?: string
    type?: string
    message?: string
    thread_source?: string
    source?: unknown
  }
}

interface CodexMeta {
  id: string
  cwd: string
  timestamp?: string
  codexKind?: 'subagent'
}

interface CodexCandidate {
  filePath: string
  meta: CodexMeta
}

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

function hasSubagentSource(source: unknown): boolean {
  return (
    source !== null &&
    typeof source === 'object' &&
    Object.hasOwn(source, 'subagent') &&
    (source as { subagent?: unknown }).subagent !== undefined
  )
}

export function isCodexSubagentRollout(meta: { threadSource?: string; source?: unknown }): boolean {
  return meta.threadSource === 'subagent' || hasSubagentSource(meta.source)
}

function parseCodexMeta(firstLine: string): CodexMeta | null {
  let line: CodexRolloutLine
  try {
    line = JSON.parse(firstLine.trim()) as CodexRolloutLine
  } catch {
    return null
  }
  if (line.type !== 'session_meta') return null
  const id = asString(line.payload?.id)
  const cwd = asString(line.payload?.cwd)
  if (id === undefined || cwd === undefined) return null
  const threadSource = asString(line.payload?.thread_source)
  return {
    id,
    cwd,
    timestamp: asString(line.payload?.timestamp),
    codexKind: isCodexSubagentRollout({ threadSource, source: line.payload?.source })
      ? 'subagent'
      : undefined,
  }
}

async function readCodexMeta(filePath: string): Promise<CodexMeta | null> {
  const firstLine = await readFirstLine(Bun.file(filePath))
  return firstLine ? parseCodexMeta(firstLine) : null
}

function shouldIncludeCodexMeta(
  meta: CodexMeta | null,
  resolvedProject: string,
  includeSubagents: boolean,
): meta is CodexMeta {
  if (!meta?.id || !meta.cwd || path.resolve(meta.cwd) !== resolvedProject) return false
  return includeSubagents || meta.codexKind !== 'subagent'
}

async function collectCodexCandidates(
  root: string,
  resolvedProject: string,
  maxFiles: number,
  maxAgeDays: number,
  includeSubagents: boolean,
  targetId?: string,
): Promise<{ candidates: CodexCandidate[]; capped: boolean }> {
  const candidates: CodexCandidate[] = []
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000

  async function consider(filePath: string): Promise<boolean> {
    if (targetId && !path.basename(filePath).includes(targetId)) return false
    const meta = await readCodexMeta(filePath)
    if (!shouldIncludeCodexMeta(meta, resolvedProject, includeSubagents)) return false
    if (candidates.length >= maxFiles) return true
    candidates.push({ filePath, meta })
    return false
  }

  const years = (await listSubdirs(root)).filter((n) => /^\d{4}$/.test(n)).sort(numericDesc)
  for (const year of years) {
    const yearDir = path.join(root, year)
    const months = (await listSubdirs(yearDir)).filter((n) => /^\d{2}$/.test(n)).sort(numericDesc)
    for (const month of months) {
      const monthDir = path.join(yearDir, month)
      const days = (await listSubdirs(monthDir)).filter((n) => /^\d{2}$/.test(n)).sort(numericDesc)
      for (const day of days) {
        const dayEndMs = Date.parse(`${year}-${month}-${day}T23:59:59Z`)
        if (Number.isFinite(dayEndMs) && dayEndMs < cutoffMs) {
          return { candidates, capped: false }
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
          if (await consider(path.join(dayDir, file))) return { candidates, capped: true }
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
      if (await consider(path.join(root, file))) return { candidates, capped: true }
    }
  } catch {
    // no legacy files
  }

  return { candidates, capped: false }
}

async function readCodexRollout(
  filePath: string,
  resolvedProject: string,
  knownMeta?: CodexMeta,
): Promise<SessionSummary | null> {
  const file = Bun.file(filePath)

  const meta = knownMeta ?? (await readCodexMeta(filePath))
  if (!meta?.id || !meta.cwd || path.resolve(meta.cwd) !== resolvedProject) return null

  let text: string
  try {
    text = await file.text()
  } catch {
    text = ''
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
    lastModified: meta.timestamp ?? new Date(0).toISOString(),
    turnCount: userCount,
    preview,
    source: 'codex',
    codexKind: meta.codexKind,
  }
}

/** Run up to `limit` tasks concurrently, swallowing individual errors. */
async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) {
        await fn(queue.shift()!).catch(() => {})
      }
    }),
  )
}

/** List this project's Codex sessions via a bounded newest-first scan. */
export async function listCodexSessions(
  projectPath: string,
  homeDir = os.homedir(),
  opts: { maxFiles?: number; maxAgeDays?: number; includeSubagents?: boolean } = {},
): Promise<CodexListResult> {
  const maxFiles = opts.maxFiles ?? CODEX_DEFAULT_MAX_FILES
  const maxAgeDays = opts.maxAgeDays ?? CODEX_DEFAULT_MAX_AGE_DAYS
  const includeSubagents = opts.includeSubagents ?? false
  const root = path.join(homeDir, '.codex', 'sessions')
  const resolvedProject = path.resolve(projectPath)

  const { candidates, capped } = await collectCodexCandidates(
    root,
    resolvedProject,
    maxFiles,
    maxAgeDays,
    includeSubagents,
  )
  const rows: SessionSummary[] = []

  await withConcurrency(candidates, CODEX_READ_CONCURRENCY, async ({ filePath, meta }) => {
    const row = await readCodexRollout(filePath, resolvedProject, meta)
    if (row) rows.push(row)
  })

  rows.sort((a, b) => b.lastModified.localeCompare(a.lastModified))
  return { rows, capped }
}

export async function lookupCodexMeta(
  threadId: string,
  projectPath: string,
  homeDir: string,
): Promise<ExternalSessionMeta | null> {
  const root = path.join(homeDir, '.codex', 'sessions')
  const resolvedProject = path.resolve(projectPath)
  const { candidates } = await collectCodexCandidates(
    root,
    resolvedProject,
    CODEX_DEFAULT_MAX_FILES,
    CODEX_DEFAULT_MAX_AGE_DAYS,
    true,
    threadId,
  )

  for (const { filePath, meta } of candidates) {
    try {
      const row = await readCodexRollout(filePath, resolvedProject, meta)
      if (row && row.id === threadId) {
        return { messageCount: row.turnCount, preview: row.preview, lastModified: row.lastModified }
      }
    } catch {
      // Skip an unreadable rollout and keep looking.
    }
  }
  return null
}

export async function findCodexRolloutPath(
  threadId: string,
  projectPath: string,
  homeDir = os.homedir(),
  opts: { maxFiles?: number; maxAgeDays?: number } = {},
): Promise<string | null> {
  const root = path.join(homeDir, '.codex', 'sessions')
  const resolvedProject = path.resolve(projectPath)
  const { candidates } = await collectCodexCandidates(
    root,
    resolvedProject,
    opts.maxFiles ?? CODEX_DEFAULT_MAX_FILES,
    opts.maxAgeDays ?? CODEX_DEFAULT_MAX_AGE_DAYS,
    true,
    threadId,
  )

  return candidates.find(({ meta }) => meta.id === threadId)?.filePath ?? null
}
