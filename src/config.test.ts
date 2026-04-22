import { describe, expect, it } from 'bun:test'

import { ORB_VERSION, parseCliArgs } from './config'
import { DEFAULT_CONFIG } from './types'

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

  it('parses common TTS flags consistently', () => {
    const { config } = parseCliArgs(['--no-streaming-tts', '--tts-speed=2'])

    expect(config.ttsStreamingEnabled).toBe(false)
    expect(config.ttsSpeed).toBe(2)
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

  it('uses global-config defaults without marking them as CLI input', () => {
    const { config, explicit } = parseCliArgs([], {
      baseConfig: {
        ...DEFAULT_CONFIG,
        llmProvider: 'openai',
        llmModel: 'gpt-5.4-mini',
        ttsServerUrl: 'http://voicebox.local:8000',
      },
      baseExplicit: { provider: true, model: true },
    })

    expect(config.llmProvider).toBe('openai')
    expect(config.llmModel).toBe('gpt-5.4-mini')
    expect(config.ttsServerUrl).toBe('http://voicebox.local:8000')
    expect(explicit.provider).toBe(true)
    expect(explicit.model).toBe(true)
  })

  it('lets CLI flags override global-config defaults', () => {
    const { config } = parseCliArgs(['--provider=anthropic', '--model=haiku'], {
      baseConfig: {
        ...DEFAULT_CONFIG,
        llmProvider: 'openai',
        llmModel: 'gpt-5.4-mini',
      },
      baseExplicit: { provider: true, model: true },
    })

    expect(config.llmProvider).toBe('anthropic')
    expect(config.llmModel).toBe('claude-haiku-4-5-20251001')
  })

  it('rejects removed advanced tuning flags', () => {
    expect(() => parseCliArgs(['--tts-max-wait-ms=250'])).toThrow()
  })

  it('enables yolo mode with --yolo', () => {
    const { config } = parseCliArgs(['--yolo'])
    expect(config.yolo).toBe(true)
  })

  it('defaults yolo to false', () => {
    const { config } = parseCliArgs([])
    expect(config.yolo).toBe(false)
  })

  it('prints the current package version for --version', () => {
    let stdout = ''
    const originalWrite = process.stdout.write

    Object.defineProperty(process.stdout, 'write', {
      value: ((chunk: string | Uint8Array) => {
        stdout += String(chunk)
        return true
      }) as typeof process.stdout.write,
      configurable: true,
    })

    try {
      expect(() => parseCliArgs(['--version'])).toThrow()
    } finally {
      Object.defineProperty(process.stdout, 'write', {
        value: originalWrite,
        configurable: true,
      })
    }

    expect(stdout.trim()).toBe(ORB_VERSION)
  })
})
