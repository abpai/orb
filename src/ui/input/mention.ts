import type { TextBufferState } from './TextBuffer'

/**
 * An active `@`-mention the user is currently typing: the column of the `@`
 * and the query text between it and the cursor.
 */
export interface ActiveMention {
  /** Column of the triggering `@` on the current row. */
  start: number
  /** Text typed after the `@`, up to the cursor (may be empty). */
  query: string
}

/**
 * Characters allowed immediately before `@` for it to count as a mention
 * trigger. Start-of-line also qualifies. This admits natural boundaries like a
 * space, an opening quote/bracket/paren, while still rejecting mid-token `@`
 * (e.g. the `@` in an email address `andy@example.com`).
 */
const BOUNDARY_BEFORE_AT = /[\s"'`([{<]/

/**
 * Find the `@`-mention the cursor is currently inside, scanning the current row
 * only. Returns `null` when there is no active mention — when the cursor is not
 * preceded by an unbroken `@token`, or the `@` is mid-token (not at a boundary).
 *
 * The query never contains whitespace or a second `@`: we stop at the nearest
 * `@` walking left and bail the moment we hit whitespace first.
 */
export function findActiveMention(line: string, col: number): ActiveMention | null {
  for (let i = col - 1; i >= 0; i--) {
    const ch = line[i]!
    if (ch === '@') {
      const atBoundary = i === 0 || BOUNDARY_BEFORE_AT.test(line[i - 1]!)
      if (!atBoundary) return null
      return { start: i, query: line.slice(i + 1, col) }
    }
    if (/\s/.test(ch)) return null
  }
  return null
}

/**
 * Replace the active mention's `@query` span on the current row with `path`
 * followed by a single space, leaving the cursor just after the inserted space.
 * `start` is the column of the `@`; the span removed is `[start, buffer.col)`.
 */
export function applyMention(
  buffer: TextBufferState,
  start: number,
  path: string,
): TextBufferState {
  const line = buffer.lines[buffer.row] ?? ''
  const insert = `${path} `
  const newLine = line.slice(0, start) + insert + line.slice(buffer.col)
  const nextLines = buffer.lines.slice()
  nextLines[buffer.row] = newLine
  return {
    lines: nextLines,
    row: buffer.row,
    col: start + insert.length,
  }
}
