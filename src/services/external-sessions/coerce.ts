/**
 * JSON coercion guards shared by the external-session adapters. Claude Code and
 * Codex stores are written by other tools, so every field read out of their
 * JSON/JSONL is `unknown` until proven — these narrow a value to the expected
 * primitive (or `undefined`) instead of trusting the shape.
 */

/** True when `value` is a non-null object (so property access is safe). */
export function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null
}

/** The value when it is a string, else `undefined`. */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** The value when it is a finite number, else `undefined`. */
export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
