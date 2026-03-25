import React from 'react'
import { render } from 'ink'
import { App } from './ui/App'
import { DEFAULT_CONFIG, DEFAULT_MODEL_BY_PROVIDER, parseCliArgs } from './config'
import type { ExplicitFlags } from './config'
import type { AppConfig } from './types'
import { applyGlobalConfig, loadGlobalConfig } from './services/global-config'
import { resolveSmartProvider } from './services/provider-defaults'
import { loadSession } from './services/session'
import { runSetupCommand } from './setup'

export { App } from './ui/App'
export { parseCliArgs, DEFAULT_CONFIG } from './config'
export type { AnthropicModel, AppConfig, LlmModelId, LlmProvider, Voice } from './types'

const OPENAI_STREAMING_DEFAULTS = {
  ttsBufferSentences: 3,
  ttsMinChunkLength: 60,
  ttsMaxWaitMs: 600,
  ttsGraceWindowMs: 200,
  ttsClauseBoundaries: true,
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
  const command = args[0]
  if (command === 'setup') {
    await runSetupCommand(args.slice(1))
    return
  }

  const globalConfig = await loadGlobalConfig()
  for (const warning of globalConfig.warnings) {
    console.warn(`[orb] ${warning}`)
  }

  const baseConfig = applyGlobalConfig(DEFAULT_CONFIG, globalConfig.config)
  const { config, explicit } = parseCliArgs(args, {
    baseConfig,
    baseExplicit: globalConfig.explicit,
  })
  if (!explicit.provider && !explicit.model) {
    const smartProvider = await resolveSmartProvider(config)
    if (!smartProvider) {
      console.error(
        'No available LLM credentials found. Set up Claude (Max/OAuth), OPENAI_API_KEY, or ANTHROPIC_API_KEY before starting.\n' +
          'Tip: Use --provider anthropic (with ANTHROPIC_API_KEY) or --provider openai (with OPENAI_API_KEY) to bypass auto-detection.',
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

  render(React.createElement(App, { config, initialSession }), {
    patchConsole: true,
  })
}
