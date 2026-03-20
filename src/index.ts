import React from 'react'
import { basename } from 'node:path'
import { render } from 'ink'
import { App } from './ui/App'
import { DEFAULT_MODEL_BY_PROVIDER, parseCliArgs } from './config'
import type { ExplicitFlags } from './config'
import type { AppConfig } from './types'
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

function applyOpenAiStreamingDefaults(config: AppConfig, explicit: ExplicitFlags) {
  if (config.llmProvider !== 'openai') return
  if (!config.ttsEnabled || !config.ttsStreamingEnabled) return

  if (!explicit.ttsBufferSentences) {
    config.ttsBufferSentences = OPENAI_STREAMING_DEFAULTS.ttsBufferSentences
  }
  if (!explicit.ttsMinChunkLength) {
    config.ttsMinChunkLength = OPENAI_STREAMING_DEFAULTS.ttsMinChunkLength
  }
  if (!explicit.ttsMaxWaitMs) {
    config.ttsMaxWaitMs = OPENAI_STREAMING_DEFAULTS.ttsMaxWaitMs
  }
  if (!explicit.ttsGraceWindowMs) {
    config.ttsGraceWindowMs = OPENAI_STREAMING_DEFAULTS.ttsGraceWindowMs
  }
  if (!explicit.ttsClauseBoundaries) {
    config.ttsClauseBoundaries = OPENAI_STREAMING_DEFAULTS.ttsClauseBoundaries
  }
}

export async function run(args: string[]): Promise<void> {
  const { config, explicit } = parseCliArgs(args)
  if (!explicit.provider && !explicit.model) {
    const smartProvider = await resolveSmartProvider(config)
    if (!smartProvider) {
      console.error(
        'No available LLM credentials found. Set up Claude (Max/OAuth), OPENAI_API_KEY, or ANTHROPIC_API_KEY before starting.',
      )
      process.exit(1)
    }
    config.llmProvider = smartProvider.provider
    if (!explicit.model) {
      config.llmModel = DEFAULT_MODEL_BY_PROVIDER[smartProvider.provider]
    }
  }
  applyOpenAiStreamingDefaults(config, explicit)
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
