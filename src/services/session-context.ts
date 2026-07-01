import os from 'node:os'
import path from 'node:path'

import { findClaudeTranscriptPath } from './external-sessions/claude'
import { asString } from './external-sessions/coerce'
import { findCodexRolloutPath } from './external-sessions/codex'

export type SessionContextProvider = 'claude' | 'codex'
export type SessionContextRole = 'user' | 'assistant' | 'tool'
export type SessionContextFormat = 'markdown' | 'json'

export interface SessionReference {
  provider: SessionContextProvider
  id: string
  cwd: string
}

export interface SessionContextEntry {
  index: number
  role: SessionContextRole
  text: string
  timestamp?: string
}

export interface SessionContextResult {
  reference: SessionReference
  transcriptPath: string
  entries: SessionContextEntry[]
  totalEntries: number
}

export interface LoadSessionContextOptions {
  homeDir?: string
  tail?: number
  includeTools?: boolean
  maxEntryChars?: number
}

interface ContentPiece {
  kind: 'text' | 'tool'
  text: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function trimText(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n').trim()
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 20)).trimEnd()}\n...[truncated]`
}

function stringifyCompact(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseProvider(raw: string, explicit?: string): SessionContextProvider {
  const value = (explicit ?? raw).toLowerCase()
  if (/\b(claude|anthropic)\b/.test(value)) return 'claude'
  if (/\b(codex|openai)\b/.test(value)) return 'codex'
  if (/\bthread\s*id\b/i.test(raw)) return 'codex'
  throw new Error('Could not determine provider. Include "claude" or "codex" in the input.')
}

function parseId(raw: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim()
  const match =
    raw.match(/\b(?:session|thread)\s+id\s*:\s*([^\s]+)/i) ??
    raw.match(/\b(?:sessionId|threadId|id)\s*[:=]\s*([^\s]+)/i)
  if (!match?.[1]) throw new Error('Could not find a session/thread id in the input.')
  return match[1].trim()
}

function parseCwd(raw: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim()
  const cwdLine = raw.match(/(?:^|\n)\s*cwd\s*:\s*(.+?)(?:\n|$)/i)
  if (cwdLine?.[1]?.trim()) return cwdLine[1].trim()
  const pathMatch = raw.match(/(\/Users\/[^\n]+|\/[A-Za-z0-9._~/-]+\/[A-Za-z0-9._~/-]+)/)
  if (pathMatch?.[1]) return pathMatch[1].trim()
  throw new Error('Could not find cwd in the input.')
}

export function parseSessionReference(
  rawInput: string,
  explicit: Partial<SessionReference> = {},
): SessionReference {
  const raw = rawInput.trim()
  return {
    provider: explicit.provider ?? parseProvider(raw, explicit.provider),
    id: parseId(raw, explicit.id),
    cwd: path.resolve(parseCwd(raw, explicit.cwd)),
  }
}

export async function resolveSessionTranscriptPath(
  reference: SessionReference,
  homeDir = os.homedir(),
): Promise<string> {
  const transcriptPath =
    reference.provider === 'claude'
      ? await findClaudeTranscriptPath(reference.id, reference.cwd, homeDir)
      : await findCodexRolloutPath(reference.id, reference.cwd, homeDir)

  if (!transcriptPath) {
    throw new Error(
      `Could not find ${reference.provider} transcript for ${reference.id} in ${reference.cwd}.`,
    )
  }
  return transcriptPath
}

function contentPieces(content: unknown): ContentPiece[] {
  if (typeof content === 'string') return [{ kind: 'text', text: trimText(content) }]
  if (!Array.isArray(content)) return []

  const pieces: ContentPiece[] = []
  for (const item of content) {
    const block = asRecord(item)
    if (!block) continue
    const type = asString(block.type)

    if (
      (type === 'text' || type === 'output_text' || type === 'input_text') &&
      typeof block.text === 'string'
    ) {
      pieces.push({ kind: 'text', text: trimText(block.text) })
      continue
    }

    if (type === 'tool_use') {
      const name = asString(block.name) ?? 'tool'
      const input = block.input === undefined ? '' : ` ${stringifyCompact(block.input)}`
      pieces.push({ kind: 'tool', text: `tool use: ${name}${input}` })
      continue
    }

    if (type === 'tool_result') {
      const contentText = stringifyCompact(block.content ?? '')
      pieces.push({ kind: 'tool', text: `tool result: ${trimText(contentText)}` })
    }
  }
  return pieces.filter((piece) => piece.text.length > 0)
}

function entry(
  entries: SessionContextEntry[],
  role: SessionContextRole,
  text: string,
  timestamp: string | undefined,
  maxEntryChars: number,
): void {
  const cleaned = truncateText(trimText(text), maxEntryChars)
  if (!cleaned) return
  entries.push({ index: entries.length + 1, role, text: cleaned, timestamp })
}

function normalizeClaudeLine(
  value: unknown,
  entries: SessionContextEntry[],
  includeTools: boolean,
  maxEntryChars: number,
): void {
  const line = asRecord(value)
  if (!line) return
  const type = asString(line.type)
  const message = asRecord(line.message)
  const timestamp = asString(line.timestamp)
  const pieces = contentPieces(message?.content)

  if (type === 'user') {
    for (const piece of pieces) {
      if (piece.kind === 'tool') {
        if (includeTools) entry(entries, 'tool', piece.text, timestamp, maxEntryChars)
      } else {
        entry(entries, 'user', piece.text, timestamp, maxEntryChars)
      }
    }
  } else if (type === 'assistant') {
    for (const piece of pieces) {
      const role = piece.kind === 'tool' ? 'tool' : 'assistant'
      if (role !== 'tool' || includeTools)
        entry(entries, role, piece.text, timestamp, maxEntryChars)
    }
  }
}

function normalizeCodexLine(
  value: unknown,
  entries: SessionContextEntry[],
  includeTools: boolean,
  maxEntryChars: number,
): void {
  const line = asRecord(value)
  if (!line) return
  const type = asString(line.type)
  const payload = asRecord(line.payload)
  const timestamp = asString(payload?.timestamp)

  if (type === 'event_msg' && asString(payload?.type) === 'user_message') {
    const message = asString(payload?.message)
    if (message) entry(entries, 'user', message, timestamp, maxEntryChars)
    return
  }

  if (type !== 'response_item') return
  const item = asRecord(payload?.item) ?? payload
  const itemType = asString(item?.type)

  if (itemType === 'message') {
    const role = asString(item?.role) === 'user' ? 'user' : 'assistant'
    for (const piece of contentPieces(item?.content)) {
      if (piece.kind === 'tool') {
        if (includeTools) entry(entries, 'tool', piece.text, timestamp, maxEntryChars)
      } else {
        entry(entries, role, piece.text, timestamp, maxEntryChars)
      }
    }
    return
  }

  if (!includeTools) return
  if (itemType === 'function_call' || itemType === 'tool_call') {
    const name = asString(item?.name) ?? asString(item?.call_id) ?? 'tool'
    const args = asString(item?.arguments) ?? stringifyCompact(item?.input ?? {})
    entry(entries, 'tool', `tool call: ${name} ${args}`, timestamp, maxEntryChars)
    return
  }

  if (itemType === 'function_call_output' || itemType === 'tool_result') {
    const output = asString(item?.output) ?? stringifyCompact(item?.content ?? '')
    entry(entries, 'tool', `tool output: ${output}`, timestamp, maxEntryChars)
  }
}

async function normalizeTranscript(
  provider: SessionContextProvider,
  transcriptPath: string,
  options: Required<Pick<LoadSessionContextOptions, 'includeTools' | 'maxEntryChars'>>,
): Promise<SessionContextEntry[]> {
  const text = await Bun.file(transcriptPath).text()
  const entries: SessionContextEntry[] = []

  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (provider === 'claude') {
      normalizeClaudeLine(parsed, entries, options.includeTools, options.maxEntryChars)
    } else {
      normalizeCodexLine(parsed, entries, options.includeTools, options.maxEntryChars)
    }
  }

  return entries
}

export async function loadSessionContext(
  rawOrReference: string | SessionReference,
  options: LoadSessionContextOptions = {},
): Promise<SessionContextResult> {
  const reference =
    typeof rawOrReference === 'string' ? parseSessionReference(rawOrReference) : rawOrReference
  const transcriptPath = await resolveSessionTranscriptPath(reference, options.homeDir)
  const entries = await normalizeTranscript(reference.provider, transcriptPath, {
    includeTools: options.includeTools ?? true,
    maxEntryChars: options.maxEntryChars ?? 1200,
  })
  const tail = Math.max(1, options.tail ?? 30)

  return {
    reference,
    transcriptPath,
    entries: entries.slice(-tail),
    totalEntries: entries.length,
  }
}

function providerLabel(provider: SessionContextProvider): string {
  return provider === 'claude' ? 'Claude' : 'Codex'
}

export function formatSessionContext(
  context: SessionContextResult,
  format: SessionContextFormat = 'markdown',
): string {
  if (format === 'json') return `${JSON.stringify(context, null, 2)}\n`

  const lines = [
    '# Session Context',
    '',
    `- Provider: ${providerLabel(context.reference.provider)}`,
    `- Session: ${context.reference.id}`,
    `- cwd: ${context.reference.cwd}`,
    `- Transcript: ${context.transcriptPath}`,
    `- Showing: ${context.entries.length} of ${context.totalEntries} normalized entries`,
    '',
    '## Recent Entries',
  ]

  if (context.entries.length === 0) {
    lines.push('', 'No user, assistant, or tool entries were found in the transcript.')
    return `${lines.join('\n')}\n`
  }

  for (const item of context.entries) {
    const timestamp = item.timestamp ? ` ${item.timestamp}` : ''
    lines.push('', `### ${item.index}. ${item.role}${timestamp}`, '', item.text)
  }

  return `${lines.join('\n')}\n`
}

export function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`)
  return parsed
}
