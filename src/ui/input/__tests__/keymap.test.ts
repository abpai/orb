import { describe, expect, it } from 'bun:test'

import { keyToAction } from '../keymap'

describe('keyToAction', () => {
  it('treats Ctrl+J as newline before the generic return branch', () => {
    expect(keyToAction('j', { ctrl: true, return: true } as never)).toEqual({ kind: 'newline' })
  })

  it('treats meta+return as newline', () => {
    expect(keyToAction('', { return: true, meta: true } as never)).toEqual({ kind: 'newline' })
  })

  it('treats meta+b/f as word movement', () => {
    expect(keyToAction('b', { meta: true } as never)).toEqual({ kind: 'move-word-left' })
    expect(keyToAction('f', { meta: true } as never)).toEqual({ kind: 'move-word-right' })
  })

  it('treats meta+B/F (shifted) as word movement', () => {
    expect(keyToAction('B', { meta: true } as never)).toEqual({ kind: 'move-word-left' })
    expect(keyToAction('F', { meta: true } as never)).toEqual({ kind: 'move-word-right' })
  })

  it('inserts a plain b/f with no modifier', () => {
    expect(keyToAction('b', {} as never)).toEqual({ kind: 'insert', text: 'b' })
    expect(keyToAction('f', {} as never)).toEqual({ kind: 'insert', text: 'f' })
  })

  it('treats meta+arrow keys as word movement', () => {
    expect(keyToAction('', { leftArrow: true, meta: true } as never)).toEqual({
      kind: 'move-word-left',
    })
    expect(keyToAction('', { rightArrow: true, meta: true } as never)).toEqual({
      kind: 'move-word-right',
    })
  })

  it('treats raw modified-enter CSI sequences as newline', () => {
    expect(keyToAction('\u001b[27;2;13~', {} as never)).toEqual({ kind: 'newline' })
    expect(keyToAction('[27;2;13~', {} as never)).toEqual({ kind: 'newline' })
    expect(keyToAction('\u001b[13;3u', {} as never)).toEqual({ kind: 'newline' })
    expect(keyToAction('[13;3u', {} as never)).toEqual({ kind: 'newline' })
  })

  it('treats raw DEL / BS bytes as backspace', () => {
    expect(keyToAction('\u007f', {} as never)).toEqual({ kind: 'backspace' })
    expect(keyToAction('\b', {} as never)).toEqual({ kind: 'backspace' })
  })

  it('treats key.delete (what Ink reports for macOS Backspace) as backspace', () => {
    expect(keyToAction('', { delete: true } as never)).toEqual({ kind: 'backspace' })
  })

  it('maps Escape to dismiss', () => {
    expect(keyToAction('', { escape: true } as never)).toEqual({ kind: 'dismiss' })
  })
})
