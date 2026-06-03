import { describe, expect, it } from 'bun:test'

import { applyMention, findActiveMention } from './mention'
import type { TextBufferState } from './TextBuffer'

describe('findActiveMention', () => {
  it('detects a mention at the start of the line', () => {
    expect(findActiveMention('@src', 4)).toEqual({ start: 0, query: 'src' })
  })

  it('detects an empty query right after typing @', () => {
    expect(findActiveMention('chat about @', 12)).toEqual({ start: 11, query: '' })
  })

  it('detects a mention after whitespace', () => {
    expect(findActiveMention('see @foo/bar.ts', 15)).toEqual({ start: 4, query: 'foo/bar.ts' })
  })

  it('returns null after a whitespace break following the query', () => {
    expect(findActiveMention('@foo bar', 8)).toBeNull()
  })

  it('rejects a mid-token @ (email address)', () => {
    expect(findActiveMention('andy@example.com', 16)).toBeNull()
  })

  it('uses the cursor position, not the line end', () => {
    // Cursor sits right after "@fo" in "@foobar".
    expect(findActiveMention('@foobar', 3)).toEqual({ start: 0, query: 'fo' })
  })

  it('accepts opening-bracket and quote boundaries', () => {
    expect(findActiveMention('(@a.ts', 6)).toEqual({ start: 1, query: 'a.ts' })
    expect(findActiveMention('`@a.ts', 6)).toEqual({ start: 1, query: 'a.ts' })
  })

  it('returns null when there is no @ before the cursor', () => {
    expect(findActiveMention('plain text', 10)).toBeNull()
    expect(findActiveMention('', 0)).toBeNull()
  })

  it('latches onto the nearest mention when several exist', () => {
    expect(findActiveMention('@a @b', 5)).toEqual({ start: 3, query: 'b' })
  })
})

describe('applyMention', () => {
  const buf = (line: string, col: number): TextBufferState => ({
    lines: [line],
    row: 0,
    col,
  })

  it('replaces the @query span with the path and a trailing space', () => {
    const result = applyMention(buf('chat about @src', 15), 11, 'src/foo.ts')
    expect(result.lines[0]).toBe('chat about src/foo.ts ')
    expect(result.col).toBe('chat about src/foo.ts '.length)
  })

  it('preserves text after the cursor', () => {
    const result = applyMention(buf('@a end', 2), 0, 'alpha.ts')
    expect(result.lines[0]).toBe('alpha.ts  end')
    expect(result.col).toBe('alpha.ts '.length)
  })

  it('only touches the active row in a multi-line buffer', () => {
    const state: TextBufferState = { lines: ['first', 'see @b', 'third'], row: 1, col: 6 }
    const result = applyMention(state, 4, 'beta.ts')
    expect(result.lines).toEqual(['first', 'see beta.ts ', 'third'])
    expect(result.row).toBe(1)
  })
})
