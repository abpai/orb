import type { Key } from 'ink'

/**
 * Key -> high-level action for the text input.
 *
 * Ink 6 quirks worth knowing:
 *   - `0x7f` (what macOS Backspace emits) is reported as `key.delete`, not
 *     `key.backspace`. Fn+Delete / PC Delete also sets `key.delete`. We route
 *     both to backspace — forward-delete is effectively never wanted here.
 *   - `key.return` fires for both `\r` and `\n` and for Alt+Enter. Ctrl+J must
 *     be checked before the return branch to win as newline.
 *   - Some terminals (e.g. Kitty/WezTerm modifyOtherKeys) emit modified Enter
 *     as a raw CSI sequence that Ink passes through as `input`. Normalize
 *     those to newline so the escape text never lands in the buffer.
 *   - Ink has no bracketed-paste state machine. Multi-char `input` with no
 *     modifier flags is treated as a paste; `paste.ts` strips the markers.
 */
export type Action =
  | { kind: 'submit' }
  | { kind: 'newline' }
  | { kind: 'backspace' }
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

const RAW_MODIFIED_ENTER = /^(?:\u001b)?\[(?:27;\d+;13~|13;\d+u)$/
const RAW_BACKSPACE = new Set(['\u007f', '\b'])

export const keyToAction = (input: string, key: Key): Action => {
  if (key.ctrl && input === 'j') return { kind: 'newline' }
  if (RAW_MODIFIED_ENTER.test(input)) return { kind: 'newline' }

  if (key.return) return key.meta ? { kind: 'newline' } : { kind: 'submit' }

  if (key.backspace || key.delete || RAW_BACKSPACE.has(input)) return { kind: 'backspace' }

  if (key.escape || key.tab) return { kind: 'ignore' }

  if (key.leftArrow) return { kind: key.meta ? 'move-word-left' : 'move-left' }
  if (key.rightArrow) return { kind: key.meta ? 'move-word-right' : 'move-right' }
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
        return { kind: 'ignore' }
    }
  }

  if (key.meta) return { kind: 'ignore' }
  if (input.length === 0) return { kind: 'ignore' }

  return { kind: 'insert', text: input }
}
