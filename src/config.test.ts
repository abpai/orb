import { describe, expect, it } from 'bun:test'

import { buildHelpText, createProgram, ORB_VERSION, parseCliArgs } from './config'
import { DEFAULT_CONFIG } from './types'

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
const helpText = () => buildHelpText(createProgram({ config: DEFAULT_CONFIG }))

describe('parseCliArgs', () => {
  it('supports provider:model shorthand for OpenAI', () => {
    const { config } = parseCliArgs(['--model=openai:gpt-4o'])

    expect(config.llmProvider).toBe('openai')
    expect(config.llmModel).toBe('gpt-4o')
  })

  it('supports AI Gateway provider/model shorthand for OpenAI', () => {
    const { config } = parseCliArgs(['--model=openai/gpt-5.5'])

    expect(config.llmProvider).toBe('openai')
    expect(config.llmModel).toBe('openai/gpt-5.5')
  })

  it('supports provider:model shorthand for Gemini', () => {
    const { config } = parseCliArgs(['--model=gemini:gemini-3.1-flash-lite-preview'])

    expect(config.llmProvider).toBe('gemini')
    expect(config.llmModel).toBe('gemini-3.1-flash-lite-preview')
  })

  it('supports provider:model shorthand for Anthropic family versions', () => {
    const { config } = parseCliArgs(['--model=anthropic:opus-4.8'])

    expect(config.llmProvider).toBe('anthropic')
    expect(config.llmModel).toBe('opus-4.8')
  })

  it('falls back to the OpenAI default model when given an Anthropic alias with OpenAI', () => {
    const { config } = parseCliArgs(['--provider=openai', '--model=sonnet'])

    expect(config.llmProvider).toBe('openai')
    expect(config.llmModel).toBe('gpt-5.5')
  })

  it('parses OpenAI reasoning effort overrides', () => {
    const { config } = parseCliArgs(['--reasoning-effort=xhigh'])

    expect(config.llmReasoningEffort).toBe('xhigh')
  })

  it('parses Claude session handoff flags and selects Anthropic', () => {
    const { config, explicit } = parseCliArgs(['--claude-session=claude-session-123'])

    expect(config.llmProvider).toBe('anthropic')
    expect(config.llmModel).toBe('haiku')
    expect(config.resumeSession).toEqual({
      provider: 'anthropic',
      sessionId: 'claude-session-123',
    })
    expect(explicit.provider).toBe(true)
  })

  it('parses Codex thread handoff flags and selects OpenAI', () => {
    const { config, explicit } = parseCliArgs(['--codex-thread=thread-123'], {
      baseConfig: {
        ...DEFAULT_CONFIG,
        llmProvider: 'anthropic',
        llmModel: 'sonnet',
      },
    })

    expect(config.llmProvider).toBe('openai')
    expect(config.llmModel).toBe('gpt-5.5')
    expect(config.resumeSession).toEqual({
      provider: 'openai',
      threadId: 'thread-123',
    })
    expect(explicit.provider).toBe(true)
  })

  it('parses generic provider-prefixed handoff flags', () => {
    expect(parseCliArgs(['--resume-session=claude:session-1']).config.resumeSession).toEqual({
      provider: 'anthropic',
      sessionId: 'session-1',
    })

    expect(parseCliArgs(['--resume-session=codex:thread-1']).config.resumeSession).toEqual({
      provider: 'openai',
      threadId: 'thread-1',
    })
  })

  it('rejects provider/model conflicts with handoff sessions', () => {
    expect(() => parseCliArgs(['--provider=openai', '--claude-session=session-1'])).toThrow(
      /handoff session is for anthropic/,
    )
    expect(() => parseCliArgs(['--model=anthropic:opus', '--codex-thread=thread-1'])).toThrow(
      /handoff session is for openai/,
    )
  })

  it('rejects ambiguous generic handoff values', () => {
    expect(() => parseCliArgs(['--resume-session=not-prefixed'])).toThrow(
      /Expected --resume-session/,
    )
  })

  it('falls back to the Gemini default model when given an Anthropic alias with Gemini', () => {
    const { config } = parseCliArgs(['--provider=gemini', '--model=sonnet'])

    expect(config.llmProvider).toBe('gemini')
    expect(config.llmModel).toBe('pro')
  })

  it('preserves the opus alias for runtime model-catalog resolution', () => {
    const { config } = parseCliArgs(['--provider=anthropic', '--model=opus'])

    expect(config.llmProvider).toBe('anthropic')
    expect(config.llmModel).toBe('opus')
  })

  it('parses common TTS flags consistently', () => {
    const { config } = parseCliArgs(['--no-streaming-tts', '--tts-speed=2'])

    expect(config.ttsStreamingEnabled).toBe(false)
    expect(config.ttsSpeed).toBe(2)
  })

  it('accepts valid --voice values', () => {
    const { config } = parseCliArgs(['--voice=jean'])
    expect(config.ttsVoice).toBe('jean')
  })

  it('rejects unknown --voice values', () => {
    expect(() => parseCliArgs(['--voice=nosuchthing'])).toThrow(/nosuchthing/)
  })

  it('accepts valid --tts-mode values', () => {
    expect(parseCliArgs(['--tts-mode=serve']).config.ttsMode).toBe('serve')
    expect(parseCliArgs(['--tts-mode=generate']).config.ttsMode).toBe('generate')
  })

  it('normalizes --tts-mode=server to serve', () => {
    expect(parseCliArgs(['--tts-mode=server']).config.ttsMode).toBe('serve')
  })

  it('rejects unknown --tts-mode values', () => {
    expect(() => parseCliArgs(['--tts-mode=turbo'])).toThrow(/turbo/)
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
    expect(config.llmModel).toBe('haiku')
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

describe('buildHelpText', () => {
  it('lists subcommands in a Commands section', () => {
    const help = stripAnsi(helpText())
    expect(help).toContain('Commands:')
    expect(help).toContain('orb setup')
    expect(help).toContain('orb sessions')
  })

  it('orders Commands, then Common options, then Advanced options', () => {
    const help = stripAnsi(helpText())
    const commands = help.indexOf('Commands:')
    const common = help.indexOf('Common options:')
    const advanced = help.indexOf('Advanced options:')
    expect(commands).toBeGreaterThanOrEqual(0)
    expect(common).toBeGreaterThan(commands)
    expect(advanced).toBeGreaterThan(common)
  })

  it('keeps everyday flags in Common and the rest in Advanced', () => {
    const help = stripAnsi(helpText())
    const common = help.slice(help.indexOf('Common options:'), help.indexOf('Examples:'))
    const advanced = help.slice(help.indexOf('Advanced options:'))
    expect(common).toContain('--model')
    expect(common).toContain('--no-tts')
    expect(common).not.toContain('--reasoning-effort')
    expect(advanced).toContain('--reasoning-effort')
    expect(advanced).toContain('--yolo')
    expect(advanced).toContain('--claude-session')
  })

  it('renders every registered flag plus version and help (anti-drift)', () => {
    const program = createProgram({ config: DEFAULT_CONFIG })
    const help = stripAnsi(buildHelpText(program))
    for (const opt of program.options) {
      if (opt.hidden) continue
      expect(help).toContain(opt.flags)
    }
    expect(help).toContain('-V, --version')
    expect(help).toContain('-h, --help')
  })

  it('keeps the Common allowlist in sync with registered flags', () => {
    const program = createProgram({ config: DEFAULT_CONFIG })
    const longs = new Set(program.options.map((o) => o.long).filter(Boolean))
    // Everything we mark Common must still be a real, registered flag.
    for (const flag of [
      '--provider',
      '--model',
      '--voice',
      '--new',
      '--resume',
      '--skip-intro',
      '--no-tts',
    ]) {
      expect(longs.has(flag)).toBe(true)
    }
  })

  it('uses cyan headers on an interactive TTY and none when NO_COLOR is set', () => {
    const originalTTY = process.stdout.isTTY
    const originalNoColor = process.env.NO_COLOR
    const setTTY = (value: boolean) =>
      Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
    try {
      setTTY(true)
      delete process.env.NO_COLOR
      expect(helpText()).toContain('\x1b[36m')

      process.env.NO_COLOR = '1'
      expect(helpText()).not.toMatch(/\x1b\[/)
    } finally {
      setTTY(originalTTY as boolean)
      if (originalNoColor === undefined) delete process.env.NO_COLOR
      else process.env.NO_COLOR = originalNoColor
    }
  })
})
