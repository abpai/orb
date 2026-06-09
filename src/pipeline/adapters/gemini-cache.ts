import type { LanguageModelUsage, ProviderMetadata } from 'ai'
import { warn } from '../../services/log'

// Minimum prompt-prefix size at which Gemini implicit caching can engage. Google's
// current docs list 1,024 tokens for Flash models and 4,096 for Pro models; use
// the smaller value so cache-eligible Flash requests are included in the signal.
export const GEMINI_IMPLICIT_CACHE_MIN_TOKENS = 1024

export interface GeminiCacheReport {
  /** Total input (prompt) tokens billed for the turn. */
  inputTokens: number
  /** Input tokens served from cache (read) rather than billed at full price. */
  cachedInputTokens: number
  /** Fraction of input tokens served from cache, in [0, 1]. */
  hitRate: number
  /**
   * Heuristic: the request was large enough to benefit from caching, yet zero
   * input tokens were served from cache. Because `inputTokens` is the whole
   * request (it over-approximates the reusable prefix), a large one-off prompt
   * can trip this without any cache hit having been expected — so treat it as a
   * signal to investigate, not proof. The common real cause is implicit caching
   * being silently disabled on tool-using requests (vercel/ai#11513), which
   * re-bills the stable system prefix at full input price every turn.
   */
  cacheLikelyDisabled: boolean
}

/**
 * Pure: turn an AI SDK usage record (plus Google provider metadata) into a cache
 * effectiveness report. Reads the normalized `inputTokenDetails.cacheReadTokens`
 * first, falls back to the deprecated flat field, then to Google's raw
 * `usageMetadata.cachedContentTokenCount` — whichever the SDK happens to populate.
 */
export function buildGeminiCacheReport(
  usage: LanguageModelUsage | undefined,
  providerMetadata?: ProviderMetadata,
): GeminiCacheReport {
  const inputTokens = usage?.inputTokens ?? 0
  const cachedInputTokens =
    usage?.inputTokenDetails?.cacheReadTokens ??
    usage?.cachedInputTokens ??
    readGoogleCachedTokens(providerMetadata) ??
    0
  const hitRate = inputTokens > 0 ? cachedInputTokens / inputTokens : 0
  const cacheLikelyDisabled =
    inputTokens >= GEMINI_IMPLICIT_CACHE_MIN_TOKENS && cachedInputTokens === 0
  return { inputTokens, cachedInputTokens, hitRate, cacheLikelyDisabled }
}

function readGoogleCachedTokens(providerMetadata?: ProviderMetadata): number | undefined {
  const usageMetadata = (
    providerMetadata?.google as
      | { usageMetadata?: { cachedContentTokenCount?: number | null } }
      | undefined
  )?.usageMetadata
  const count = usageMetadata?.cachedContentTokenCount
  return typeof count === 'number' ? count : undefined
}

// Warn at most once per process: a stable upstream limitation shouldn't spam a
// line on every single turn.
let warnedCacheDisabled = false

/**
 * Surface a one-time warning when Gemini implicit caching isn't engaging on a
 * cacheable prefix. Best-effort observability — callers should never let this
 * affect a turn. Returns true when a warning was actually emitted (for testing).
 */
export function reportGeminiCacheUsage(report: GeminiCacheReport): boolean {
  if (!report.cacheLikelyDisabled || warnedCacheDisabled) return false
  warnedCacheDisabled = true
  warn(
    `Gemini served 0 of ${report.inputTokens} input tokens from cache on a request large enough to ` +
      'benefit. Tool-using requests can silently disable implicit caching (vercel/ai#11513); if this ' +
      'persists, the stable system prefix is being re-billed at full input price each turn. This ' +
      'warning is shown once per session.',
  )
  return true
}

// Test-only: reset the once-per-process warn latch.
export function resetGeminiCacheWarnings(): void {
  warnedCacheDisabled = false
}
