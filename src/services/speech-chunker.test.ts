import { describe, expect, it } from 'bun:test'
import {
  SOFT_BOUNDARY,
  STRONG_BOUNDARY,
  extractChunkAtBoundary,
  extractStrongChunks,
  findLastMatchIndex,
  findLastWhitespaceIndex,
} from './speech-chunker'

describe('findLastMatchIndex', () => {
  it('returns -1 for no match', () => {
    expect(findLastMatchIndex('hello world', STRONG_BOUNDARY)).toBe(-1)
  })

  it('returns end index of last match', () => {
    expect(findLastMatchIndex('Hello. World.', STRONG_BOUNDARY)).toBe(13)
  })

  it('works with soft boundary', () => {
    const idx = findLastMatchIndex('one, two, three', SOFT_BOUNDARY)
    expect(idx).toBe(10) // after "two, "
  })

  it('handles a pattern without the g flag by adding it', () => {
    const noG = new RegExp(STRONG_BOUNDARY.source) // no g flag
    expect(findLastMatchIndex('Yes! No.', noG)).toBe(8)
  })
})

describe('findLastWhitespaceIndex', () => {
  it('returns -1 when no whitespace', () => {
    expect(findLastWhitespaceIndex('hello')).toBe(-1)
  })

  it('returns position after last space', () => {
    expect(findLastWhitespaceIndex('one two three')).toBe(8) // 'three' starts at 8
  })

  it('handles tab and newline', () => {
    expect(findLastWhitespaceIndex('a\tb')).toBe(2)
    expect(findLastWhitespaceIndex('a\nb')).toBe(2)
  })

  it('returns position after trailing space', () => {
    expect(findLastWhitespaceIndex('word ')).toBe(5)
  })
})

describe('extractStrongChunks', () => {
  it('returns empty for text with no strong boundary', () => {
    expect(extractStrongChunks('hello world')).toEqual({ chunks: [], consumed: 0 })
  })

  it('extracts a single sentence', () => {
    const { chunks, consumed } = extractStrongChunks('Hello world. ')
    expect(chunks).toEqual(['Hello world.'])
    expect(consumed).toBe(13)
  })

  it('extracts multiple sentences', () => {
    const { chunks, consumed } = extractStrongChunks('First. Second! Third? ')
    expect(chunks).toEqual(['First.', 'Second!', 'Third?'])
    expect(consumed).toBe(22)
  })

  it('leaves unterminated text as unconsumed', () => {
    const { chunks, consumed } = extractStrongChunks('Done. Incomplete')
    expect(chunks).toEqual(['Done.'])
    expect(consumed).toBe(6)
    expect('Done. Incomplete'.slice(consumed)).toBe('Incomplete')
  })

  it('handles punctuation followed by closing quote', () => {
    const { chunks } = extractStrongChunks('She said "stop." ')
    expect(chunks).toEqual(['She said "stop."'])
  })

  it('skips whitespace-only slices', () => {
    const { chunks } = extractStrongChunks('   . Next sentence. ')
    expect(chunks.every((c) => c.trim().length > 0)).toBe(true)
  })
})

describe('extractChunkAtBoundary', () => {
  it('returns null for boundary <= 0', () => {
    expect(extractChunkAtBoundary('hello', 0, 5, false)).toEqual({ chunk: null, consumed: 0 })
    expect(extractChunkAtBoundary('hello', -1, 5, false)).toEqual({ chunk: null, consumed: 0 })
  })

  it('extracts chunk up to boundary', () => {
    expect(extractChunkAtBoundary('hello world', 6, 0, false)).toEqual({
      chunk: 'hello',
      consumed: 6,
    })
  })

  it('rejects chunk below minLength when not forceFlush', () => {
    expect(extractChunkAtBoundary('hi', 3, 10, false)).toEqual({ chunk: null, consumed: 0 })
  })

  it('accepts chunk below minLength when forceFlush', () => {
    expect(extractChunkAtBoundary('hi', 3, 10, true)).toEqual({ chunk: 'hi', consumed: 3 })
  })

  it('returns null for whitespace-only slice', () => {
    expect(extractChunkAtBoundary('   ', 3, 0, false)).toEqual({ chunk: null, consumed: 0 })
  })

  it('trims trailing whitespace from the chunk', () => {
    const result = extractChunkAtBoundary('hello   ', 8, 0, false)
    expect(result.chunk).toBe('hello')
    expect(result.consumed).toBe(8)
  })
})
