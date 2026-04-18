import type { Key } from 'ink'

/**
 * Key -> high-level action for the text input.
 *
 * Notable subtleties:
 *   - Ink collapses 0x0A (Ctrl+J) and 0x0D (Enter) to `key.return=true`. We
 *     distinguish Ctrl+J by checking `key.ctrl && input === 'j'` BEFORE the
 *     return branch.
 *   - Alt+Enter arrives as `key.return` + `key.meta`. We treat it as newline.
 *   - Ink has no bracketed-paste state machine. Multi-char `input` with no
 *     modifier flags is treated as a paste; `paste.ts` strips markers.
 *   - Shift+Tab and Tab are deliberately unclaimed (`ignore`) because the
 *     global shortcut hook owns them (model cycling).
 */
export type Action =
  | { kind: 'submit' }
  | { kind: 'newline' }
  | { kind: 'backspace' }
  | { kind: 'delete-forward' }
  | { kind: 'move-left' }
  | { kind: 'move-right' }
  | { kind: 'move-up' }
  | { kind: 'move-down' }
  | { kind: 'move-home' }
  | { kind: 'move-end' }
  | { kind: 'move-word-left' }
  | { kind: 'move-word-right' }
  | { kind: 'delete-word-left' }
  | { kind: 'kill-to-line-end' }
  | { kind: 'kill-line' }
  | { kind: 'insert'; text: string }
  | { kind: 'ignore' }

export const keyToAction = (input: string, key: Key): Action => {
  // Must come before the `key.return` branch because Ink maps both \r and \n
  // to key.return. Ctrl+J is the cross-terminal multi-line fallback.
  if (key.ctrl && input === 'j') return { kind: 'newline' }

  if (key.return) {
    if (key.meta) return { kind: 'newline' } // Alt+Enter
    return { kind: 'submit' }
  }

  if (key.tab) return { kind: 'ignore' }
  if (input === '\u001b[Z') return { kind: 'ignore' } // raw Shift+Tab
  if (key.escape) return { kind: 'ignore' }

  if (key.backspace) return { kind: 'backspace' }
  if (key.delete) return { kind: 'delete-forward' }

  if (key.leftArrow) {
    return key.meta ? { kind: 'move-word-left' } : { kind: 'move-left' }
  }
  if (key.rightArrow) {
    return key.meta ? { kind: 'move-word-right' } : { kind: 'move-right' }
  }
  if (key.upArrow) return { kind: 'move-up' }
  if (key.downArrow) return { kind: 'move-down' }
  if (key.home) return { kind: 'move-home' }
  if (key.end) return { kind: 'move-end' }

  if (key.ctrl) {
    switch (input) {
      case 'a':
        return { kind: 'move-home' }
      case 'e':
        return { kind: 'move-end' }
      case 'k':
        return { kind: 'kill-to-line-end' }
      case 'u':
        return { kind: 'kill-line' }
      case 'w':
        return { kind: 'delete-word-left' }
      default:
        return { kind: 'ignore' } // let the global hook claim it (e.g. Ctrl+O, Ctrl+C)
    }
  }

  if (key.meta) return { kind: 'ignore' }

  if (input.length === 0) return { kind: 'ignore' }

  return { kind: 'insert', text: input }
}
