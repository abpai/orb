import { describe, expect, it } from 'bun:test'

import { sanitizePaste } from '../paste'

describe('sanitizePaste', () => {
  it('strips bracketed-paste markers emitted by the terminal', () => {
    expect(sanitizePaste('\u001b[200~hello\u001b[201~')).toBe('hello')
  })

  it('strips a leading start-marker without a matching end-marker', () => {
    expect(sanitizePaste('\u001b[200~hello')).toBe('hello')
  })

  it('normalizes CRLF and CR line endings to LF', () => {
    expect(sanitizePaste('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('is a no-op for plain text', () => {
    expect(sanitizePaste('plain text')).toBe('plain text')
  })
})
