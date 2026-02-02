import React from 'react'
import { basename } from 'node:path'
import { render } from 'ink'
import { App } from './ui/App'
import { DEFAULT_MODEL_BY_PROVIDER, parseCliArgs } from './config'
import { resolveSmartProvider } from './services/provider-defaults'
import { loadSession } from './services/session'

export { App } from './ui/App'
export { parseCliArgs, DEFAULT_CONFIG } from './config'
export type { AnthropicModel, AppConfig, LlmModelId, LlmProvider, Voice } from './types'

const MAX_CONTENT_WIDTH = 56
const OPENAI_STREAMING_DEFAULTS = {
  ttsBufferSentences: 3,
  ttsMinChunkLength: 60,
  ttsMaxWaitMs: 600,
  ttsGraceWindowMs: 200,
  ttsClauseBoundaries: true,
}

function formatLine(label: string, value: string): string {
  const prefix = `${label}: `
  const available = Math.max(0, MAX_CONTENT_WIDTH - prefix.length)
  if (value.length > available && available > 1) {
    return `${prefix}\u2026${value.slice(value.length - (available - 1))}`
  }
  return `${prefix}${value.slice(0, available)}`
}

function padCenter(value: string, width: number): string {
  if (value.length >= width) return value
  const totalPad = width - value.length
  const left = Math.floor(totalPad / 2)
  const right = totalPad - left
  return `${' '.repeat(left)}${value}${' '.repeat(right)}`
}

function showHelp(): void {
  console.info(`
orb - Voice-Driven Code Explorer

Usage: orb [projectPath] [options]

Options:
  --provider=<provider>  LLM provider: anthropic|claude, openai|gpt (alias: --llm-provider)
  --voice=<voice>    TTS voice: alba, marius, jean (default: alba)
  --tts-mode=<mode>  TTS mode: generate, serve (default: serve)
  --tts-server-url=<url>  Pocket TTS server URL (implies serve, default: http://localhost:8000)
  --tts-speed=<rate> TTS speed multiplier (default: 1.5)
  --tts-buffer-sentences=<count>  Sentences to buffer before playback (default: 1, OpenAI: 3)
  --tts-clause-boundaries  Enable comma/semicolon/colon split points (OpenAI default: on)
  --tts-min-chunk-length=<count>  Minimum chars before soft flush (default: 15, OpenAI: 60)
  --tts-max-wait-ms=<ms>  Max latency before forcing a flush (default: 150, OpenAI: 600)
  --tts-grace-window-ms=<ms>  Extra wait when near a boundary (default: 50, OpenAI: 200)
  --model=<model>    Model ID or alias (haiku, sonnet, opus) or provider:model (openai:gpt-4o)
  --openai-login     Run OpenAI browser login (uses codex CLI)
  --openai-device-login  Run OpenAI device login (uses codex CLI)
  --openai-api=<api> OpenAI API mode: responses | chat (default: responses)
  --new              Start fresh (ignore saved session)
  --no-tts           Disable text-to-speech
  --no-streaming-tts Disable streaming (batch mode)
  --help             Show this help message

Auto provider selection (when --provider and --model are omitted):
  1) Claude Agent SDK (OAuth / Max)
  2) OpenAI OAuth (codex)
  3) OPENAI_API_KEY
  4) ANTHROPIC_API_KEY

Examples:
  orb                           # Current directory with defaults
  orb /path/to/project          # Specific project
  orb --voice=marius
  orb --provider=openai --model=gpt-4o
  orb --model=openai:gpt-4o

Controls:
  - Type your question and press Enter
  - Paste MacWhisper transcription with Cmd+V
  - Shift+Tab to cycle models
  - Ctrl+C to exit
`)
}

function hasArgPrefix(args: string[], prefix: string): boolean {
  return args.some((arg) => arg.startsWith(prefix))
}

function hasArgFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

function applyOpenAiStreamingDefaults(config: ReturnType<typeof parseCliArgs>, args: string[]) {
  if (config.llmProvider !== 'openai') return
  if (!config.ttsEnabled || !config.ttsStreamingEnabled) return

  if (!hasArgPrefix(args, '--tts-buffer-sentences=')) {
    config.ttsBufferSentences = OPENAI_STREAMING_DEFAULTS.ttsBufferSentences
  }
  if (!hasArgPrefix(args, '--tts-min-chunk-length=')) {
    config.ttsMinChunkLength = OPENAI_STREAMING_DEFAULTS.ttsMinChunkLength
  }
  if (!hasArgPrefix(args, '--tts-max-wait-ms=')) {
    config.ttsMaxWaitMs = OPENAI_STREAMING_DEFAULTS.ttsMaxWaitMs
  }
  if (!hasArgPrefix(args, '--tts-grace-window-ms=')) {
    config.ttsGraceWindowMs = OPENAI_STREAMING_DEFAULTS.ttsGraceWindowMs
  }
  if (
    !hasArgFlag(args, '--tts-clause-boundaries') &&
    !hasArgFlag(args, '--no-tts-clause-boundaries')
  ) {
    config.ttsClauseBoundaries = OPENAI_STREAMING_DEFAULTS.ttsClauseBoundaries
  }
}

export async function run(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    showHelp()
    process.exit(0)
  }

  const config = parseCliArgs(args)
  const providerExplicit = args.some(
    (arg) => arg.startsWith('--provider=') || arg.startsWith('--llm-provider='),
  )
  const modelExplicit = args.some((arg) => arg.startsWith('--model='))
  if (!providerExplicit && !modelExplicit) {
    const smartProvider = await resolveSmartProvider(config)
    if (!smartProvider) {
      console.error(
        'No available LLM credentials found. Set up Claude (Max/OAuth), OpenAI OAuth, OPENAI_API_KEY, or ANTHROPIC_API_KEY before starting.',
      )
      process.exit(1)
    }
    config.llmProvider = smartProvider.provider
    if (!modelExplicit) {
      config.llmModel = DEFAULT_MODEL_BY_PROVIDER[smartProvider.provider]
    }
  }
  applyOpenAiStreamingDefaults(config, args)
  const initialSession = config.startFresh ? null : await loadSession(config.projectPath)
  const sessionMatchesProvider = initialSession?.llmProvider === config.llmProvider
  const modelLabel =
    (sessionMatchesProvider ? initialSession?.llmModel : undefined) ?? config.llmModel
  const ttsModeLabel = config.ttsMode === 'serve' ? 'server' : 'generate'
  const ttsLabel = config.ttsEnabled
    ? `${config.ttsVoice}, ${ttsModeLabel}, x${config.ttsSpeed}`
    : 'Disabled'
  const projectName = basename(config.projectPath) || config.projectPath

  const infoLines = [
    formatLine('Project', projectName),
    formatLine('Path', config.projectPath),
    formatLine('Provider', config.llmProvider),
    formatLine('Model', modelLabel),
    formatLine('TTS', ttsLabel),
  ]

  if (config.ttsEnabled && config.ttsMode === 'serve') {
    infoLines.push(formatLine('TTS URL', config.ttsServerUrl || 'http://localhost:8000'))
  }

  const contentWidth = Math.max('orb'.length, ...infoLines.map((line) => line.length))
  const topBorder = `╭${'─'.repeat(contentWidth + 2)}╮`
  const bottomBorder = `╰${'─'.repeat(contentWidth + 2)}╯`
  const titleLine = `│ ${padCenter('orb', contentWidth)} │`
  const spacerLine = `│ ${' '.repeat(contentWidth)} │`
  const detailLines = infoLines.map((line) => `│ ${line.padEnd(contentWidth)} │`)

  console.info(`
${topBorder}
${titleLine}
${spacerLine}
${detailLines.join('\n')}
${bottomBorder}
`)

  render(React.createElement(App, { config, initialSession }), {
    patchConsole: true,
  })
}
