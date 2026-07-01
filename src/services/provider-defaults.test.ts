import { describe, expect, it } from 'bun:test'

import type { ExplicitFlags } from '../config'
import { DEFAULT_CONFIG, type AppConfig } from '../types'
import { applyHighThroughputStreamingDefaults } from './provider-defaults'

const NO_EXPLICIT_TTS_DEFAULTS: ExplicitFlags = {
  provider: false,
  model: false,
  ttsBufferSentences: false,
  ttsMinChunkLength: false,
  ttsMaxWaitMs: false,
  ttsGraceWindowMs: false,
  ttsClauseBoundaries: false,
}

function config(overrides: Partial<AppConfig>): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    projectPath: '/tmp/orb',
    ...overrides,
  }
}

describe('applyHighThroughputStreamingDefaults', () => {
  it.each(['openai', 'cursor'] as const)('applies calmer TTS defaults for %s', (provider) => {
    const appConfig = config({ llmProvider: provider, ttsEnabled: true, ttsStreamingEnabled: true })

    applyHighThroughputStreamingDefaults(appConfig, NO_EXPLICIT_TTS_DEFAULTS)

    expect(appConfig).toMatchObject({
      ttsBufferSentences: 3,
      ttsMinChunkLength: 100,
      ttsMaxWaitMs: 1200,
      ttsGraceWindowMs: 300,
      ttsClauseBoundaries: false,
    })
  })

  it('keeps explicit Cursor TTS timing overrides', () => {
    const appConfig = config({
      llmProvider: 'cursor',
      ttsEnabled: true,
      ttsStreamingEnabled: true,
      ttsBufferSentences: 1,
      ttsMinChunkLength: 25,
      ttsMaxWaitMs: 200,
      ttsGraceWindowMs: 75,
      ttsClauseBoundaries: true,
    })

    applyHighThroughputStreamingDefaults(appConfig, {
      ...NO_EXPLICIT_TTS_DEFAULTS,
      ttsBufferSentences: true,
      ttsMinChunkLength: true,
      ttsMaxWaitMs: true,
      ttsGraceWindowMs: true,
      ttsClauseBoundaries: true,
    })

    expect(appConfig).toMatchObject({
      ttsBufferSentences: 1,
      ttsMinChunkLength: 25,
      ttsMaxWaitMs: 200,
      ttsGraceWindowMs: 75,
      ttsClauseBoundaries: true,
    })
  })

  it('leaves Anthropic on the lower-latency defaults', () => {
    const appConfig = config({
      llmProvider: 'anthropic',
      ttsEnabled: true,
      ttsStreamingEnabled: true,
    })

    applyHighThroughputStreamingDefaults(appConfig, NO_EXPLICIT_TTS_DEFAULTS)

    expect(appConfig).toMatchObject({
      ttsBufferSentences: DEFAULT_CONFIG.ttsBufferSentences,
      ttsMinChunkLength: DEFAULT_CONFIG.ttsMinChunkLength,
      ttsMaxWaitMs: DEFAULT_CONFIG.ttsMaxWaitMs,
      ttsGraceWindowMs: DEFAULT_CONFIG.ttsGraceWindowMs,
      ttsClauseBoundaries: DEFAULT_CONFIG.ttsClauseBoundaries,
    })
  })

  it('does not change Cursor when streaming TTS is disabled', () => {
    const appConfig = config({
      llmProvider: 'cursor',
      ttsEnabled: true,
      ttsStreamingEnabled: false,
    })

    applyHighThroughputStreamingDefaults(appConfig, NO_EXPLICIT_TTS_DEFAULTS)

    expect(appConfig).toMatchObject({
      ttsBufferSentences: DEFAULT_CONFIG.ttsBufferSentences,
      ttsMinChunkLength: DEFAULT_CONFIG.ttsMinChunkLength,
      ttsMaxWaitMs: DEFAULT_CONFIG.ttsMaxWaitMs,
      ttsGraceWindowMs: DEFAULT_CONFIG.ttsGraceWindowMs,
      ttsClauseBoundaries: DEFAULT_CONFIG.ttsClauseBoundaries,
    })
  })
})
