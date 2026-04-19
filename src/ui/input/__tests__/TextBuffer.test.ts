import { describe, expect, it } from 'bun:test'

import {
  backspace,
  deleteForward,
  deleteWordLeft,
  empty,
  fromString,
  insert,
  isEmpty,
  killLine,
  killToLineEnd,
  moveDown,
  moveEnd,
  moveHome,
  moveLeft,
  moveRight,
  moveUp,
  moveWordLeft,
  moveWordRight,
  newline,
  toString,
  type TextBufferState,
} from '../TextBuffer'

const at = (text: string, row: number, col: number): TextBufferState => {
  const lines = text.split('\n')
  return { lines, row, col }
}

describe('TextBuffer', () => {
  describe('empty / fromString / toString', () => {
    it('starts empty with a single empty line', () => {
      const b = empty()
      expect(b.lines).toEqual([''])
      expect(b.row).toBe(0)
      expect(b.col).toBe(0)
      expect(isEmpty(b)).toBe(true)
    })

    it('round-trips strings with LF, CR, CRLF line endings', () => {
      expect(toString(fromString('a\nb\nc'))).toBe('a\nb\nc')
      expect(toString(fromString('a\r\nb'))).toBe('a\nb')
      expect(toString(fromString('a\rb'))).toBe('a\nb')
    })

    it('fromString parks the cursor at the end', () => {
      const b = fromString('hello\nworld')
      expect(b.row).toBe(1)
      expect(b.col).toBe(5)
    })
  })

  describe('insert', () => {
    it('inserts a plain string at cursor', () => {
      const b = insert(empty(), 'abc')
      expect(toString(b)).toBe('abc')
      expect(b.col).toBe(3)
    })

    it('inserts into the middle of a line', () => {
      const b = insert(at('hello', 0, 2), 'XYZ')
      expect(toString(b)).toBe('heXYZllo')
      expect(b.col).toBe(5)
    })

    it('splits the line on embedded newline', () => {
      const b = insert(at('hello', 0, 2), '\n')
      expect(b.lines).toEqual(['he', 'llo'])
      expect(b.row).toBe(1)
      expect(b.col).toBe(0)
    })

    it('handles multi-line paste', () => {
      const b = insert(at('first|last', 0, 5), 'a\nb\nc')
      expect(b.lines).toEqual(['firsta', 'b', 'c|last'])
      expect(b.row).toBe(2)
      expect(b.col).toBe(1)
    })

    it('is a no-op for empty input', () => {
      const before = at('abc', 0, 1)
      expect(insert(before, '')).toBe(before)
    })
  })

  describe('backspace', () => {
    it('deletes the previous character within a line', () => {
      const b = backspace(at('abcd', 0, 3))
      expect(toString(b)).toBe('abd')
      expect(b.col).toBe(2)
    })

    it('joins lines when at column 0', () => {
      const b = backspace(at('ab\ncd', 1, 0))
      expect(b.lines).toEqual(['abcd'])
      expect(b.row).toBe(0)
      expect(b.col).toBe(2)
    })

    it('is a no-op at document start', () => {
      const before = at('abc', 0, 0)
      expect(backspace(before)).toEqual(before)
    })
  })

  describe('deleteForward', () => {
    it('deletes the character under the cursor', () => {
      const b = deleteForward(at('abcd', 0, 1))
      expect(toString(b)).toBe('acd')
      expect(b.col).toBe(1)
    })

    it('joins with next line when at end of line', () => {
      const b = deleteForward(at('ab\ncd', 0, 2))
      expect(b.lines).toEqual(['abcd'])
      expect(b.row).toBe(0)
      expect(b.col).toBe(2)
    })

    it('is a no-op at document end', () => {
      const before = at('abc', 0, 3)
      expect(deleteForward(before)).toEqual(before)
    })
  })

  describe('newline', () => {
    it('splits the line at the cursor', () => {
      const b = newline(at('ab', 0, 1))
      expect(b.lines).toEqual(['a', 'b'])
      expect(b.row).toBe(1)
      expect(b.col).toBe(0)
    })
  })

  describe('horizontal motion', () => {
    it('moveLeft crosses line boundaries', () => {
      const b = moveLeft(at('a\nbc', 1, 0))
      expect(b.row).toBe(0)
      expect(b.col).toBe(1)
    })

    it('moveRight crosses line boundaries', () => {
      const b = moveRight(at('ab\ncd', 0, 2))
      expect(b.row).toBe(1)
      expect(b.col).toBe(0)
    })

    it('moveLeft at doc start is a no-op', () => {
      const before = at('abc', 0, 0)
      expect(moveLeft(before)).toEqual(before)
    })

    it('moveRight at doc end is a no-op', () => {
      const before = at('abc', 0, 3)
      expect(moveRight(before)).toEqual(before)
    })

    it('moveHome / moveEnd clamp within a line', () => {
      expect(moveHome(at('abc', 0, 2)).col).toBe(0)
      expect(moveEnd(at('abc', 0, 1)).col).toBe(3)
    })
  })

  describe('vertical motion with desiredCol', () => {
    it('moveUp preserves the desired column when the target is long enough', () => {
      const b = moveUp(at('hello\nhi', 1, 2), 4)
      expect(b.row).toBe(0)
      expect(b.col).toBe(4)
    })

    it('moveUp clamps to line length on short lines', () => {
      const b = moveUp(at('hi\nworld', 1, 4), 4)
      expect(b.row).toBe(0)
      expect(b.col).toBe(2)
    })

    it('moveUp from first row jumps to column 0', () => {
      const b = moveUp(at('abc', 0, 2), 5)
      expect(b.row).toBe(0)
      expect(b.col).toBe(0)
    })

    it('moveDown from last row jumps to end', () => {
      const b = moveDown(at('abc', 0, 0), 0)
      expect(b.row).toBe(0)
      expect(b.col).toBe(3)
    })

    it('moveDown preserves desired column', () => {
      const b = moveDown(at('hello\nworld', 0, 1), 4)
      expect(b.row).toBe(1)
      expect(b.col).toBe(4)
    })
  })

  describe('word motion', () => {
    it('moveWordLeft jumps over trailing whitespace then the preceding word', () => {
      const b = moveWordLeft(at('foo  bar', 0, 8))
      expect(b.col).toBe(5)
    })

    it('moveWordLeft jumps across line boundaries to the previous word start', () => {
      const b = moveWordLeft(at('abc\ndef', 1, 0))
      expect(b.row).toBe(0)
      expect(b.col).toBe(0)
    })

    it('moveWordRight jumps leading whitespace then the next word', () => {
      const b = moveWordRight(at('  foo bar', 0, 0))
      expect(b.col).toBe(5)
    })

    it('moveWordRight crosses line boundaries', () => {
      const b = moveWordRight(at('abc\n  def', 0, 3))
      expect(b.row).toBe(1)
      expect(b.col).toBe(5)
    })
  })

  describe('deleteWordLeft', () => {
    it('deletes the preceding word', () => {
      const b = deleteWordLeft(at('foo bar baz', 0, 11))
      expect(toString(b)).toBe('foo bar ')
      expect(b.col).toBe(8)
    })

    it('joins lines and deletes the preceding word', () => {
      const b = deleteWordLeft(at('foo\nbar', 1, 0))
      expect(b.lines).toEqual(['bar'])
      expect(b.row).toBe(0)
      expect(b.col).toBe(0)
    })

    it('is a no-op at document start', () => {
      const before = at('abc', 0, 0)
      expect(deleteWordLeft(before)).toEqual(before)
    })
  })

  describe('kill operations', () => {
    it('killToLineEnd deletes the tail of the line', () => {
      const b = killToLineEnd(at('hello', 0, 2))
      expect(toString(b)).toBe('he')
      expect(b.col).toBe(2)
    })

    it('killToLineEnd at end of line joins next line', () => {
      const b = killToLineEnd(at('ab\ncd', 0, 2))
      expect(b.lines).toEqual(['abcd'])
      expect(b.col).toBe(2)
    })

    it('killLine clears the current line without collapsing rows', () => {
      const b = killLine(at('ab\ncd', 1, 2))
      expect(b.lines).toEqual(['ab', ''])
      expect(b.row).toBe(1)
      expect(b.col).toBe(0)
    })
  })
})
