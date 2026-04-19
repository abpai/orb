/**
 * Normalize pasted input for insertion into a TextBuffer.
 *
 * Ink 6 does not run a bracketed-paste state machine — when the host terminal
 * emits `\x1b[200~...\x1b[201~` around a paste, those markers leak through to
 * the `useInput` handler. Strip them here. Also normalize CR / CRLF to LF so
 * the buffer stays in canonical form.
 */
const PASTE_START = /^\u001b\[200~/
const PASTE_END = /\u001b\[201~$/

export const sanitizePaste = (raw: string): string => {
  return raw.replace(PASTE_START, '').replace(PASTE_END, '').replace(/\r\n?/g, '\n')
}
