/**
 * Multi-line text buffer as immutable state + pure functions.
 *
 * Invariants:
 *   - `lines.length >= 1` (empty buffer has one empty line)
 *   - no line contains '\n'
 *   - `0 <= row < lines.length`
 *   - `0 <= col <= lines[row].length` (col may sit past the last char)
 *
 * The `desiredCol` used for up/down column preservation is tracked by the
 * caller (usually as a ref) and passed back into `moveUp` / `moveDown`.
 */
export interface TextBufferState {
  readonly lines: readonly string[]
  readonly row: number
  readonly col: number
}

export const empty = (): TextBufferState => ({ lines: [''], row: 0, col: 0 })

export const fromString = (s: string): TextBufferState => {
  const normalized = s.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const lastRow = lines.length - 1
  return { lines, row: lastRow, col: lines[lastRow]!.length }
}

export const toString = (b: TextBufferState): string => b.lines.join('\n')

export const isEmpty = (b: TextBufferState): boolean => b.lines.length === 1 && b.lines[0] === ''

const replaceLine = (lines: readonly string[], row: number, next: string): string[] => {
  const copy = lines.slice()
  copy[row] = next
  return copy
}

/** Insert arbitrary text at the cursor. Handles embedded newlines. */
export const insert = (b: TextBufferState, text: string): TextBufferState => {
  if (text.length === 0) return b
  const normalized = text.replace(/\r\n?/g, '\n')
  const pieces = normalized.split('\n')
  const line = b.lines[b.row]!
  const before = line.slice(0, b.col)
  const after = line.slice(b.col)

  if (pieces.length === 1) {
    return {
      lines: replaceLine(b.lines, b.row, before + pieces[0] + after),
      row: b.row,
      col: b.col + pieces[0]!.length,
    }
  }

  const head = before + pieces[0]
  const tailPieces = pieces.slice(1)
  const lastPiece = tailPieces[tailPieces.length - 1]!
  const tail = lastPiece + after
  const middle = tailPieces.slice(0, -1)

  const nextLines = [...b.lines.slice(0, b.row), head, ...middle, tail, ...b.lines.slice(b.row + 1)]

  return {
    lines: nextLines,
    row: b.row + pieces.length - 1,
    col: lastPiece.length,
  }
}

export const newline = (b: TextBufferState): TextBufferState => insert(b, '\n')

export const backspace = (b: TextBufferState): TextBufferState => {
  const line = b.lines[b.row]!
  if (b.col > 0) {
    const next = line.slice(0, b.col - 1) + line.slice(b.col)
    return { lines: replaceLine(b.lines, b.row, next), row: b.row, col: b.col - 1 }
  }
  if (b.row === 0) return b
  const prev = b.lines[b.row - 1]!
  const joined = prev + line
  const nextLines = [...b.lines.slice(0, b.row - 1), joined, ...b.lines.slice(b.row + 1)]
  return { lines: nextLines, row: b.row - 1, col: prev.length }
}

export const deleteForward = (b: TextBufferState): TextBufferState => {
  const line = b.lines[b.row]!
  if (b.col < line.length) {
    const next = line.slice(0, b.col) + line.slice(b.col + 1)
    return { lines: replaceLine(b.lines, b.row, next), row: b.row, col: b.col }
  }
  if (b.row === b.lines.length - 1) return b
  const joined = line + b.lines[b.row + 1]!
  const nextLines = [...b.lines.slice(0, b.row), joined, ...b.lines.slice(b.row + 2)]
  return { lines: nextLines, row: b.row, col: b.col }
}

export const moveLeft = (b: TextBufferState): TextBufferState => {
  if (b.col > 0) return { ...b, col: b.col - 1 }
  if (b.row === 0) return b
  return { ...b, row: b.row - 1, col: b.lines[b.row - 1]!.length }
}

export const moveRight = (b: TextBufferState): TextBufferState => {
  const line = b.lines[b.row]!
  if (b.col < line.length) return { ...b, col: b.col + 1 }
  if (b.row === b.lines.length - 1) return b
  return { ...b, row: b.row + 1, col: 0 }
}

export const moveHome = (b: TextBufferState): TextBufferState => ({ ...b, col: 0 })
export const moveEnd = (b: TextBufferState): TextBufferState => ({
  ...b,
  col: b.lines[b.row]!.length,
})

export const moveUp = (b: TextBufferState, desiredCol: number): TextBufferState => {
  if (b.row === 0) return { ...b, col: 0 }
  const target = b.lines[b.row - 1]!
  return { ...b, row: b.row - 1, col: Math.min(desiredCol, target.length) }
}

export const moveDown = (b: TextBufferState, desiredCol: number): TextBufferState => {
  if (b.row === b.lines.length - 1) {
    return { ...b, col: b.lines[b.row]!.length }
  }
  const target = b.lines[b.row + 1]!
  return { ...b, row: b.row + 1, col: Math.min(desiredCol, target.length) }
}

/**
 * Word boundary: a "word" is a maximal run of non-whitespace characters.
 * moveWordLeft jumps over any whitespace immediately before the cursor, then
 * over the preceding word. moveWordRight is the mirror image.
 */
const isWordChar = (ch: string): boolean => ch.length > 0 && !/\s/.test(ch)

export const moveWordLeft = (b: TextBufferState): TextBufferState => {
  let { row, col } = b
  while (row > 0 && col === 0) {
    row -= 1
    col = b.lines[row]!.length
  }
  if (row === 0 && col === 0) return b
  const line = b.lines[row]!
  while (col > 0 && !isWordChar(line[col - 1]!)) col -= 1
  while (col > 0 && isWordChar(line[col - 1]!)) col -= 1
  return { ...b, row, col }
}

export const moveWordRight = (b: TextBufferState): TextBufferState => {
  let { row, col } = b
  const totalRows = b.lines.length
  while (row < totalRows - 1 && col === b.lines[row]!.length) {
    row += 1
    col = 0
  }
  const line = b.lines[row]!
  if (col === line.length) return b
  while (col < line.length && !isWordChar(line[col]!)) col += 1
  while (col < line.length && isWordChar(line[col]!)) col += 1
  return { ...b, row, col }
}

export const deleteWordLeft = (b: TextBufferState): TextBufferState => {
  const target = moveWordLeft(b)
  if (target.row === b.row && target.col === b.col) return b
  // Delete the range (target.row, target.col) .. (b.row, b.col)
  if (target.row === b.row) {
    const line = b.lines[b.row]!
    const next = line.slice(0, target.col) + line.slice(b.col)
    return { lines: replaceLine(b.lines, b.row, next), row: b.row, col: target.col }
  }
  const headLine = b.lines[target.row]!
  const tailLine = b.lines[b.row]!
  const joined = headLine.slice(0, target.col) + tailLine.slice(b.col)
  const nextLines = [...b.lines.slice(0, target.row), joined, ...b.lines.slice(b.row + 1)]
  return { lines: nextLines, row: target.row, col: target.col }
}

/** Ctrl+K: delete from cursor to end of line; on an empty tail, joins the next line. */
export const killToLineEnd = (b: TextBufferState): TextBufferState => {
  const line = b.lines[b.row]!
  if (b.col < line.length) {
    return { lines: replaceLine(b.lines, b.row, line.slice(0, b.col)), row: b.row, col: b.col }
  }
  if (b.row === b.lines.length - 1) return b
  const joined = line + b.lines[b.row + 1]!
  const nextLines = [...b.lines.slice(0, b.row), joined, ...b.lines.slice(b.row + 2)]
  return { lines: nextLines, row: b.row, col: b.col }
}

/** Ctrl+U: clear the current line. Does not collapse rows. */
export const killLine = (b: TextBufferState): TextBufferState => ({
  lines: replaceLine(b.lines, b.row, ''),
  row: b.row,
  col: 0,
})

/** Reset to an empty buffer. */
export const clear = (): TextBufferState => empty()
