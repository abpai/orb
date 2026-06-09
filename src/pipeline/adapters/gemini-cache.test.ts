import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import type { LanguageModelUsage, ProviderMetadata } from 'ai'
import {
  GEMINI_2_5_IMPLICIT_CACHE_MIN_TOKENS,
  GEMINI_IMPLICIT_CACHE_DEFAULT_MIN_TOKENS,
  buildGeminiCacheReport,
  geminiImplicitCacheMinTokens,
  reportGeminiCacheUsage,
  resetGeminiCacheWarnings,
} from './gemini-cache'

function usage(partial: Partial<LanguageModelUsage>): LanguageModelUsage {
  return {
    inputTokens: undefined,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: undefined,
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    totalTokens: undefined,
    ...partial,
  } as LanguageModelUsage
}

describe('buildGeminiCacheReport', () => {
  it('prefers the normalized inputTokenDetails.cacheReadTokens field', () => {
    const report = buildGeminiCacheReport(
      usage({
        inputTokens: 10_000,
        inputTokenDetails: {
          noCacheTokens: 2_000,
          cacheReadTokens: 8_000,
          cacheWriteTokens: undefined,
        },
      }),
    )
    expect(report.cachedInputTokens).toBe(8_000)
    expect(report.hitRate).toBeCloseTo(0.8)
    expect(report.cacheLikelyDisabled).toBe(false)
  })

  it('falls back to the deprecated flat cachedInputTokens field', () => {
    const report = buildGeminiCacheReport(usage({ inputTokens: 4_000, cachedInputTokens: 1_000 }))
    expect(report.cachedInputTokens).toBe(1_000)
    expect(report.hitRate).toBeCloseTo(0.25)
  })

  it("falls back to Google's raw usageMetadata.cachedContentTokenCount", () => {
    const providerMetadata = {
      google: { usageMetadata: { cachedContentTokenCount: 3_000 } },
    } as unknown as ProviderMetadata
    const report = buildGeminiCacheReport(usage({ inputTokens: 6_000 }), providerMetadata)
    expect(report.cachedInputTokens).toBe(3_000)
  })

  it('flags a large prefix with zero cache reads as likely disabled', () => {
    const report = buildGeminiCacheReport(
      usage({ inputTokens: GEMINI_IMPLICIT_CACHE_DEFAULT_MIN_TOKENS }),
    )
    expect(report.cachedInputTokens).toBe(0)
    expect(report.cacheLikelyDisabled).toBe(true)
  })

  it('does not flag a newer Gemini prompt below its implicit-cache threshold', () => {
    const report = buildGeminiCacheReport(
      usage({ inputTokens: GEMINI_IMPLICIT_CACHE_DEFAULT_MIN_TOKENS - 1 }),
      undefined,
      { modelId: 'gemini-3.1-pro-preview' },
    )
    expect(report.implicitCacheMinTokens).toBe(GEMINI_IMPLICIT_CACHE_DEFAULT_MIN_TOKENS)
    expect(report.cacheLikelyDisabled).toBe(false)
  })

  it('uses the lower Gemini 2.5 implicit-cache threshold', () => {
    const report = buildGeminiCacheReport(
      usage({ inputTokens: GEMINI_2_5_IMPLICIT_CACHE_MIN_TOKENS }),
      undefined,
      { modelId: 'gemini-2.5-flash' },
    )
    expect(report.implicitCacheMinTokens).toBe(GEMINI_2_5_IMPLICIT_CACHE_MIN_TOKENS)
    expect(report.cacheLikelyDisabled).toBe(true)
  })

  it('classifies implicit-cache thresholds by Gemini model', () => {
    expect(geminiImplicitCacheMinTokens('gemini-3.5-flash')).toBe(
      GEMINI_IMPLICIT_CACHE_DEFAULT_MIN_TOKENS,
    )
    expect(geminiImplicitCacheMinTokens('gemini-3.1-pro-preview')).toBe(
      GEMINI_IMPLICIT_CACHE_DEFAULT_MIN_TOKENS,
    )
    expect(geminiImplicitCacheMinTokens('gemini-2.5-flash')).toBe(
      GEMINI_2_5_IMPLICIT_CACHE_MIN_TOKENS,
    )
    expect(geminiImplicitCacheMinTokens('models/gemini-2.5-pro')).toBe(
      GEMINI_2_5_IMPLICIT_CACHE_MIN_TOKENS,
    )
  })

  it('does not flag a small prefix below the implicit-cache threshold', () => {
    const report = buildGeminiCacheReport(
      usage({ inputTokens: GEMINI_2_5_IMPLICIT_CACHE_MIN_TOKENS - 1 }),
      undefined,
      { modelId: 'gemini-2.5-flash' },
    )
    expect(report.cacheLikelyDisabled).toBe(false)
  })

  it('handles missing usage without throwing or dividing by zero', () => {
    const report = buildGeminiCacheReport(undefined)
    expect(report).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      hitRate: 0,
      implicitCacheMinTokens: GEMINI_IMPLICIT_CACHE_DEFAULT_MIN_TOKENS,
      cacheLikelyDisabled: false,
    })
  })
})

describe('reportGeminiCacheUsage', () => {
  beforeEach(() => resetGeminiCacheWarnings())
  afterEach(() => resetGeminiCacheWarnings())

  it('warns once when caching is likely disabled, then stays quiet', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const disabled = buildGeminiCacheReport(usage({ inputTokens: 50_000 }))
      expect(reportGeminiCacheUsage(disabled)).toBe(true)
      expect(reportGeminiCacheUsage(disabled)).toBe(false)
      expect(warnSpy).toHaveBeenCalledTimes(1)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('stays silent when caching is working', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const healthy = buildGeminiCacheReport(
        usage({
          inputTokens: 50_000,
          inputTokenDetails: {
            noCacheTokens: 2_000,
            cacheReadTokens: 48_000,
            cacheWriteTokens: undefined,
          },
        }),
      )
      expect(reportGeminiCacheUsage(healthy)).toBe(false)
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})
