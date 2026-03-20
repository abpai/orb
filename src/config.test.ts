import { describe, expect, it } from 'bun:test'

import { parseCliArgs } from './config'

describe('parseCliArgs', () => {
  it('supports provider:model shorthand for OpenAI', () => {
    const { config } = parseCliArgs(['--model=openai:gpt-4o'])

    expect(config.llmProvider).toBe('openai')
    expect(config.llmModel).toBe('gpt-4o')
  })

  it('falls back to the OpenAI default model when given an Anthropic alias with OpenAI', () => {
    const { config } = parseCliArgs(['--provider=openai', '--model=sonnet'])

    expect(config.llmProvider).toBe('openai')
    expect(config.llmModel).toBe('gpt-5.4')
  })

  it('parses TTS flags consistently', () => {
    const { config } = parseCliArgs([
      '--no-streaming-tts',
      '--tts-clause-boundaries',
      '--tts-max-wait-ms=250',
    ])

    expect(config.ttsStreamingEnabled).toBe(false)
    expect(config.ttsClauseBoundaries).toBe(true)
    expect(config.ttsMaxWaitMs).toBe(250)
  })

  it('detects explicit provider with space-separated syntax', () => {
    const { explicit } = parseCliArgs(['--provider', 'openai'])
    expect(explicit.provider).toBe(true)
  })

  it('detects explicit model with space-separated syntax', () => {
    const { explicit } = parseCliArgs(['--model', 'openai:gpt-4o'])
    expect(explicit.model).toBe(true)
  })

  it('reports provider and model as not explicit when omitted', () => {
    const { explicit } = parseCliArgs([])
    expect(explicit.provider).toBe(false)
    expect(explicit.model).toBe(false)
  })
})
