import type { HistoryEntry, ToolCall } from '../types'

/** A reference to a file, optionally pinned to a line number. */
export interface FileRef {
  path: string
  line?: number
}

/**
 * Match a file-path token with an extension and an optional `:line` (and ignored
 * `:col`). The negative lookbehind keeps us from starting mid-token (e.g. inside
 * a URL or a longer path), so we only latch onto real boundaries — whitespace,
 * quotes, backticks, parens, the start of a markdown-link target, etc.
 *
 *   src/foo.ts          foo.ts:42         ./a/b.tsx:10:3
 *   ~/x/y.py            /abs/path.go:5    tsconfig.json
 */
const FILE_REF_RE =
  /(?<![\w@/.~-])((?:~\/|\.{0,2}\/)?(?:[\w@.+-]+\/)*[\w@.+-]+\.[A-Za-z][\w]*)(?::(\d+))?(?::\d+)?/g

/** Does this string end in a `.ext` that looks like a real file extension? */
function hasFileExtension(value: string): boolean {
  return /\.[A-Za-z][\w]*$/.test(value)
}

/**
 * Filter out prose that merely looks path-shaped. A slash-less token (a bare
 * `name.ext`) must have a 2+ char extension, which rejects abbreviations like
 * "e.g" and "i.e" while keeping real files like `foo.ts`. Tokens containing a
 * slash are always treated as paths.
 */
function looksLikeFile(path: string): boolean {
  if (path.includes('/')) return true
  const ext = path.slice(path.lastIndexOf('.') + 1)
  return ext.length >= 2
}

/**
 * Merge refs in order, deduped by path. The first occurrence wins for ordering,
 * but a later ref carrying a line number upgrades an earlier line-less one — so
 * "see foo.ts" followed by "foo.ts:42" resolves to a single `foo.ts:42`.
 */
function dedupeRefs(refs: FileRef[]): FileRef[] {
  const byPath = new Map<string, FileRef>()
  for (const ref of refs) {
    const existing = byPath.get(ref.path)
    if (!existing) {
      byPath.set(ref.path, ref)
    } else if (existing.line === undefined && ref.line !== undefined) {
      existing.line = ref.line
    }
  }
  return [...byPath.values()]
}

/** Extract file references from free text (markdown links, backticks, bare paths). */
export function parseFileRefs(text: string): FileRef[] {
  if (!text) return []

  const refs: FileRef[] = []
  for (const match of text.matchAll(FILE_REF_RE)) {
    const path = match[1]
    if (!path || !looksLikeFile(path)) continue
    const lineRaw = match[2]
    const line = lineRaw ? Number.parseInt(lineRaw, 10) : undefined
    refs.push(line && Number.isFinite(line) ? { path, line } : { path })
  }
  return dedupeRefs(refs)
}

/**
 * Parse file references the user typed explicitly (e.g. `/open Dockerfile a.ts:9`).
 * Unlike {@link parseFileRefs}, this trusts the input: each whitespace-separated
 * token is a path, even without an extension, with an optional trailing `:line`.
 * Surrounding quotes/backticks are stripped. Returns `[]` only when nothing
 * path-like was given — callers must NOT fall back to other refs when the user
 * supplied args, or `/open Dockerfile` could silently open something else.
 */
export function parseExplicitRefs(args: string): FileRef[] {
  const refs: FileRef[] = []
  for (const token of args.split(/\s+/)) {
    const cleaned = token
      .replace(/^[`'"(<]+/, '')
      .replace(/[`'")>]+$/, '')
      .trim()
    if (!cleaned) continue
    const lineMatch = cleaned.match(/^(.+?):(\d+)(?::\d+)?$/)
    if (lineMatch?.[1]) {
      refs.push({ path: lineMatch[1], line: Number.parseInt(lineMatch[2]!, 10) })
    } else {
      refs.push({ path: cleaned })
    }
  }
  return dedupeRefs(refs)
}

/**
 * Pull file references out of a single tool call's input. Covers the path-bearing
 * shapes across providers: Anthropic/Gemini read & write (`file_path`,
 * `notebook_path`, `path`), Codex file edits (`changes[].path`), and any shell
 * command string (`command`) which is scanned as free text.
 */
export function refsFromToolCall(toolCall: ToolCall): FileRef[] {
  const input = toolCall.input ?? {}
  const refs: FileRef[] = []

  const pushPath = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) refs.push({ path: value.trim() })
  }

  pushPath(input.file_path)
  pushPath(input.notebook_path)

  // `path` is also used by directory-scoped tools (grep/glob); only treat it as
  // a file when it actually looks like one, so we don't try to "open" a folder.
  if (typeof input.path === 'string' && hasFileExtension(input.path.trim())) {
    pushPath(input.path)
  }

  if (Array.isArray(input.changes)) {
    for (const change of input.changes) {
      if (change && typeof change === 'object') pushPath((change as { path?: unknown }).path)
    }
  }

  if (typeof input.command === 'string') refs.push(...parseFileRefs(input.command))

  return dedupeRefs(refs)
}

/**
 * The set of files a single turn is "about" — what its answer mentions plus what
 * its tool calls touched. Answer refs come first since the spoken/written
 * explanation is the most direct signal of what the user wants to look at.
 */
export function collectFocusRefs(turn: HistoryEntry): FileRef[] {
  const fromAnswer = parseFileRefs(turn.answer ?? '')
  const fromTools = turn.toolCalls.flatMap(refsFromToolCall)
  return dedupeRefs([...fromAnswer, ...fromTools])
}

/**
 * Focus refs for the most recent turn that references any files, scanning newest
 * first. This is what the `^G` hotkey and bare `/open` act on.
 */
export function latestFocusRefs(turns: HistoryEntry[]): FileRef[] {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (!turn) continue
    const refs = collectFocusRefs(turn)
    if (refs.length > 0) return refs
  }
  return []
}
