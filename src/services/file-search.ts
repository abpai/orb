import { promises as fsp } from 'node:fs'
import * as path from 'node:path'

import { warn } from './log'

/** Directories never worth offering as `@`-completions. */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
])

/** Bounds for the non-git fallback walk so a huge tree can't stall the input. */
const WALK_MAX_FILES = 5000
const WALK_MAX_DEPTH = 12

/** How long a listed file set stays fresh before we re-read it (ms). */
const MEMO_TTL_MS = 5_000

/** Default cap on results handed to the menu. */
export const DEFAULT_SEARCH_LIMIT = 8

/**
 * Score how well `query` matches `candidate` as a case-insensitive subsequence,
 * or return `null` when it doesn't match at all. Higher is better. The scoring
 * favors, in order: matches that land in the basename, contiguous runs, and
 * matches near the start of the segment — which is what makes typing `foo`
 * surface `foo.ts` ahead of `src/legacy/unfoothold.ts`.
 */
function subsequenceScore(query: string, candidate: string): number | null {
  if (query.length === 0) return 0
  const q = query.toLowerCase()
  const c = candidate.toLowerCase()

  let score = 0
  let qi = 0
  let prevMatch = -2
  // Reward matches that begin within the basename rather than a parent dir.
  const baseStart = c.lastIndexOf('/') + 1

  for (let ci = 0; ci < c.length && qi < q.length; ci++) {
    if (c[ci] !== q[qi]) continue
    score += 1
    if (ci === prevMatch + 1) score += 5 // contiguous run
    if (ci >= baseStart) score += 3 // inside the basename
    if (ci === baseStart) score += 4 // basename start
    prevMatch = ci
    qi++
  }
  if (qi < q.length) return null

  // Tie-break toward shorter paths so the closest file wins.
  return score - candidate.length * 0.01
}

/**
 * Rank `files` against `query`, returning at most `limit` paths best-first.
 * An empty query returns the head of the list unchanged (the caller decides
 * what "recent/top" ordering the list arrived in). Pure and synchronous so it
 * can be tested without touching the filesystem.
 */
export function rankFiles(query: string, files: string[], limit: number): string[] {
  if (query.trim().length === 0) return files.slice(0, limit)

  const scored: Array<{ path: string; score: number; index: number }> = []
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!
    const score = subsequenceScore(query, file)
    if (score !== null) scored.push({ path: file, score, index })
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map((entry) => entry.path)
}

/** Run `git ls-files` for tracked + untracked-not-ignored files, NUL-delimited. */
async function gitListFiles(projectPath: string): Promise<string[] | null> {
  try {
    const proc = Bun.spawn(
      ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: projectPath, stdout: 'pipe', stderr: 'ignore' },
    )
    const [out, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (exitCode !== 0) return null
    return out.split('\0').filter((entry) => entry.length > 0)
  } catch {
    return null
  }
}

/** Bounded breadth-limited walk used when the project isn't a git repo. */
async function walkFiles(projectPath: string): Promise<string[]> {
  const results: string[] = []

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > WALK_MAX_DEPTH || results.length >= WALK_MAX_FILES) return
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (results.length >= WALK_MAX_FILES) return
      // Skip symlinks entirely so we never escape the tree or loop.
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(path.join(dir, entry.name), depth + 1)
      } else if (entry.isFile()) {
        results.push(path.relative(projectPath, path.join(dir, entry.name)))
      }
    }
  }

  await walk(projectPath, 0)
  return results
}

interface MemoEntry {
  files: string[]
  at: number
}

const fileListCache = new Map<string, MemoEntry>()

/**
 * List project files (repo-relative), preferring `git ls-files` and falling
 * back to a bounded walk. Results are memoized per project for a few seconds so
 * keystrokes don't re-shell `git`, but the short TTL keeps a coding session's
 * freshly created files discoverable.
 */
export async function listProjectFiles(projectPath: string): Promise<string[]> {
  const cached = fileListCache.get(projectPath)
  if (cached && Date.now() - cached.at < MEMO_TTL_MS) return cached.files

  let files = await gitListFiles(projectPath)
  if (files === null) {
    try {
      files = await walkFiles(projectPath)
    } catch (error) {
      warn('file-search: failed to list project files', error)
      files = []
    }
  }

  fileListCache.set(projectPath, { files, at: Date.now() })
  return files
}

/** Drop any memoized listing for a project (e.g. to force a refresh). */
export function invalidateFileList(projectPath: string): void {
  fileListCache.delete(projectPath)
}

interface SearchOptions {
  projectPath: string
  limit?: number
}

/**
 * Search a project's files for `@`-completion. Lists (memoized) then ranks.
 * Returns at most `limit` repo-relative paths, best match first.
 */
export async function searchProjectFiles(
  query: string,
  { projectPath, limit = DEFAULT_SEARCH_LIMIT }: SearchOptions,
): Promise<string[]> {
  const files = await listProjectFiles(projectPath)
  return rankFiles(query, files, limit)
}
