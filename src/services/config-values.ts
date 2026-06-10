import {
  REASONING_EFFORTS,
  VOICES,
  type AppConfig,
  type LlmProvider,
  type ReasoningEffort,
  type Voice,
} from '../types'

// ── Shared value-level validators ────────────────────────────────────────────
//
// Config is validated on two paths that must NOT diverge semantically: the
// Commander CLI parsers (src/config.ts) and the declarative TOML field table
// (src/services/global-config.ts). Both check the same types (LlmProvider,
// Voice, ReasoningEffort, tts mode, speeds/lengths) but report failures very
// differently — the CLI throws Error with a `got "..."` message, the TOML path
// pushes a `... must be ...` warning and keeps going.
//
// To keep one source of truth without coupling the two error surfaces, each
// primitive returns a Validated<T> result. The two call sites own their own
// message formatting (see config.ts parsers / global-config field table), so
// both existing CLI error strings and TOML warning strings stay byte-identical.

/**
 * Result of a value-level validation. `ok: false` carries no message — the
 * caller renders one in its own format (CLI throw vs TOML warning).
 */
export type Validated<T> = { ok: true; value: T } | { ok: false }

const ok = <T>(value: T): Validated<T> => ({ ok: true, value })
const fail = { ok: false } as const

/**
 * Provider aliases accepted on the CLI. The TOML path intentionally does NOT
 * alias (it only takes canonical `LlmProvider` values), so it consults
 * {@link isLlmProvider} instead of this table.
 */
const PROVIDER_ALIASES: Record<string, LlmProvider> = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  gpt: 'openai',
  codex: 'openai',
  gemini: 'gemini',
  google: 'gemini',
}

/** Canonical CLI tts modes plus the `server` alias for `serve`. */
export const TTS_MODES = ['serve', 'generate', 'server'] as const

/** Normalize a provider alias (claude→anthropic, gpt/codex→openai, …). */
export function normalizeProvider(value: string): LlmProvider | undefined {
  return PROVIDER_ALIASES[value.trim().toLowerCase()]
}

/** Canonical-only provider check (no aliasing) for the TOML path. */
export function isLlmProvider(value: unknown): value is LlmProvider {
  return value === 'anthropic' || value === 'openai' || value === 'gemini'
}

/** Parse a reasoning-effort string (case-insensitive, trimmed). */
export function parseReasoningEffort(value: string): Validated<ReasoningEffort> {
  const normalized = value.trim().toLowerCase()
  return REASONING_EFFORTS.includes(normalized as ReasoningEffort)
    ? ok(normalized as ReasoningEffort)
    : fail
}

/** Canonical-only reasoning-effort check (no normalization) for the TOML path. */
export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORTS.includes(value as ReasoningEffort)
}

/** Parse a voice string (trimmed, exact match against {@link VOICES}). */
export function parseVoice(value: string): Validated<Voice> {
  const v = value.trim()
  return VOICES.includes(v as Voice) ? ok(v as Voice) : fail
}

/** Canonical-only voice check (no trimming) for the TOML path. */
export function isVoice(value: unknown): value is Voice {
  return typeof value === 'string' && VOICES.includes(value as Voice)
}

/** Parse a tts mode, folding the `server` alias to `serve`. */
export function parseTtsMode(value: string): Validated<AppConfig['ttsMode']> {
  const v = value.trim()
  if (v === 'serve' || v === 'server') return ok('serve')
  if (v === 'generate') return ok('generate')
  return fail
}

/** Canonical-only tts mode check (no `server` alias) for the TOML path. */
export function isTtsMode(value: unknown): value is AppConfig['ttsMode'] {
  return value === 'generate' || value === 'serve'
}

/** Parse a string into a positive (> 0) finite number. */
export function parsePositiveNumber(value: string): Validated<number> {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? ok(n) : fail
}

/** Parse a string into a positive (> 0) integer. */
export function parsePositiveInt(value: string): Validated<number> {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? ok(n) : fail
}

/** Parse a string into a non-negative (>= 0) integer. */
export function parseNonNegativeInt(value: string): Validated<number> {
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? ok(n) : fail
}

/** Already-typed positive (> 0) finite number check for the TOML path. */
export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Already-typed positive (> 0) integer check for the TOML path. */
export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** Already-typed non-negative (>= 0) integer check for the TOML path. */
export function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}
