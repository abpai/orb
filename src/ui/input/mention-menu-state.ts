/**
 * Whether the input prompt's `@`-file menu is currently open.
 *
 * Tracked at module scope because Ink fans every keypress out to *all*
 * registered `useInput` handlers with no way to stop propagation. The global
 * Esc handler (`useKeyboardShortcuts`, mounted in `App`) and the menu's own
 * handler (in `InputPrompt`) therefore both see Esc. This flag lets the global
 * handler defer to the menu — Esc closes the menu instead of also cancelling
 * the in-flight turn — without threading menu state up through App → Footer.
 *
 * There is a single input prompt in the app, so a module flag is sufficient;
 * `InputPrompt` resets it on unmount.
 */
let menuOpen = false

export function setMentionMenuOpen(open: boolean): void {
  menuOpen = open
}

export function isMentionMenuOpen(): boolean {
  return menuOpen
}
