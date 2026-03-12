import { describe, expect, it } from 'bun:test'

import { parseCliArgs } from './config'

describe('parseCliArgs', () => {
  it('supports provider:model shorthand for OpenAI', () => {
    const config = parseCliArgs(['--model=openai:gpt-4o'])

    expect(config.llmProvider).toBe('openai')
    expect(config.llmModel).toBe('gpt-4o')
  })

  it('falls back to the OpenAI default model when given an Anthropic alias with OpenAI', () => {
    const config = parseCliArgs(['--provider=openai', '--model=sonnet'])

    expect(config.llmProvider).toBe('openai')
    expect(config.llmModel).toBe('gpt-5.2-codex')
  })

  it('parses TTS and login flags consistently', () => {
    const config = parseCliArgs([
      '--openai-device-auth',
      '--no-streaming-tts',
      '--tts-clause-boundaries',
      '--tts-max-wait-ms=250',
    ])

    expect(config.openaiDeviceLogin).toBe(true)
    expect(config.ttsStreamingEnabled).toBe(false)
    expect(config.ttsClauseBoundaries).toBe(true)
    expect(config.ttsMaxWaitMs).toBe(250)
  })
})
