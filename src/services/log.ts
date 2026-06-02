/**
 * Emit a warning in orb's voice. Centralizes the `[orb]` prefix so every
 * warning reads with one consistent voice instead of being hand-rolled at
 * each call site (where some omitted the prefix entirely).
 */
export function warn(...args: unknown[]): void {
  console.warn('[orb]', ...args)
}
