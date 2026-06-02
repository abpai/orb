import React from 'react'
import { render } from 'ink'
import { App } from './ui/App'
import { DEFAULT_CONFIG, DEFAULT_MODEL_ALIAS_BY_PROVIDER, parseCliArgs } from './config'
import type { ExplicitFlags } from './config'
import type { AppConfig } from './types'
import { applyGlobalConfig, loadGlobalConfig } from './services/global-config'
import { resolveAppModelConfig } from './services/model-catalog'
import { resolveSmartProvider } from './services/provider-defaults'
import { loadSession } from './services/session'
import { runSetupCommand } from './setup'
import type { AgentSession, SavedSession } from './types'

export { App } from './ui/App'
export { parseCliArgs, DEFAULT_CONFIG } from './config'
export type { AnthropicModel, AppConfig, LlmModelId, LlmProvider, Voice } from './types'

const OPENAI_STREAMING_DEFAULTS = {
  ttsBufferSentences: 3,
  ttsMinChunkLength: 100,
  ttsMaxWaitMs: 1200,
  ttsGraceWindowMs: 300,
  ttsClauseBoundaries: false,
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

function shouldHandleMetaFlag(args: string[]): boolean {
  return (
    args.includes('--help') ||
    args.includes('-h') ||
    args.includes('--version') ||
    args.includes('-V')
  )
}

function providerForSession(session: AgentSession): AppConfig['llmProvider'] {
  return session.provider
}

function sameAgentSession(a: AgentSession | undefined, b: AgentSession): boolean {
  if (!a || a.provider !== b.provider) return false
  if (a.provider === 'anthropic' && b.provider === 'anthropic') return a.sessionId === b.sessionId
  if (a.provider === 'openai' && b.provider === 'openai') return a.threadId === b.threadId
  return false
}

export function createInitialSession(
  config: AppConfig,
  savedSession: SavedSession | null,
): SavedSession | null {
  const resumeSession = config.resumeSession
  if (!resumeSession) return savedSession

  const keepSavedHistory =
    !config.startFresh && sameAgentSession(savedSession?.agentSession, resumeSession)

  return {
    version: 2,
    projectPath: config.projectPath,
    llmProvider: providerForSession(resumeSession),
    llmModel: config.llmModel,
    agentSession: resumeSession,
    lastModified: savedSession?.lastModified ?? new Date().toISOString(),
    history: keepSavedHistory ? (savedSession?.history ?? []) : [],
  }
}

export async function run(args: string[]): Promise<void> {
  const command = args[0]
  if (command === 'setup') {
    await runSetupCommand(args.slice(1))
    return
  }
  if (shouldHandleMetaFlag(args)) {
    parseCliArgs(args)
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
        'No available LLM credentials found. Set up Claude (Max/OAuth), Codex ChatGPT login, GOOGLE_GENERATIVE_AI_API_KEY, or ANTHROPIC_API_KEY before starting.\n' +
          'Tip: Use --provider openai after `codex login --device-auth`, or --provider gemini with GOOGLE_GENERATIVE_AI_API_KEY.',
      )
      process.exit(1)
    }
    config.llmProvider = smartProvider.provider
    if (!explicit.model) {
      config.llmModel = DEFAULT_MODEL_ALIAS_BY_PROVIDER[smartProvider.provider]
    }
  }
  const resolvedModel = await resolveAppModelConfig(config)
  config.llmModel = resolvedModel.llmModel
  config.llmModelChoices = resolvedModel.llmModelChoices
  config.llmModelLabels = resolvedModel.llmModelLabels
  if (resolvedModel.catalog.warning) {
    console.warn(`[orb] Model catalog refresh failed: ${resolvedModel.catalog.warning}`)
  }
  applyOpenAiStreamingDefaults(config, explicit)
  const savedSession = config.startFresh ? null : await loadSession(config.projectPath)
  const initialSession = createInitialSession(config, savedSession)

  render(React.createElement(App, { config, initialSession }), {
    patchConsole: true,
  })
}
