import React from 'react'
import { randomUUID } from 'node:crypto'
import { render } from 'ink'
import { App } from './ui/App'
import { DEFAULT_CONFIG, DEFAULT_MODEL_ALIAS_BY_PROVIDER, parseCliArgs } from './config'
import type { ExplicitFlags } from './config'
import type { AppConfig } from './types'
import { applyGlobalConfig, loadGlobalConfig } from './services/global-config'
import { resolveAppModelConfig } from './services/model-catalog'
import { resolveSmartProvider } from './services/provider-defaults'
import { loadSession, loadSessionById } from './services/session'
import { lookupExternalSessionMeta } from './services/external-sessions'
import { relaunchOrb } from './services/relaunch'
import { runSessionsCommand } from './sessions-cli'
import { warn } from './services/log'
import { runSetupCommand } from './setup'
import type { AgentSession, ResumeInfo, SavedSession } from './types'

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

function sameAgentSession(a: AgentSession | undefined, b: AgentSession): boolean {
  if (!a || a.provider !== b.provider) return false
  // ubs:ignore not-a-secret — sessionId/threadId are public CLI-supplied lookup keys, not bearer tokens or HMACs
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
    id: keepSavedHistory ? (savedSession?.id ?? randomUUID()) : randomUUID(),
    projectPath: config.projectPath,
    llmProvider: resumeSession.provider,
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
  if (command === 'sessions') {
    await runSessionsCommand(args.slice(1))
    return
  }
  if (shouldHandleMetaFlag(args)) {
    parseCliArgs(args)
    return
  }

  const globalConfig = await loadGlobalConfig()
  for (const warning of globalConfig.warnings) {
    warn(warning)
  }

  const baseConfig = applyGlobalConfig(DEFAULT_CONFIG, globalConfig.config)
  const { config, explicit } = parseCliArgs(args, {
    baseConfig,
    baseExplicit: globalConfig.explicit,
  })

  // Resume a specific saved session by id (from `orb sessions`). Loaded up front
  // so the saved conversation's provider/model wins over auto-detection.
  let resumeById: SavedSession | null = null
  if (config.resumeId && !config.startFresh) {
    resumeById = await loadSessionById(config.projectPath, config.resumeId)
    if (!resumeById) {
      console.error(`No saved session "${config.resumeId}" found for ${config.projectPath}.`)
      process.exit(1)
    }
    config.llmProvider = resumeById.llmProvider
    config.llmModel = resumeById.llmModel
  }
  const resumeLocksProvider = resumeById !== null

  if (!explicit.provider && !explicit.model && !resumeLocksProvider) {
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
    warn(`Model catalog refresh failed: ${resolvedModel.catalog.warning}`)
  }
  applyOpenAiStreamingDefaults(config, explicit)
  const savedSession =
    resumeById ?? (config.startFresh ? null : await loadSession(config.projectPath))
  const initialSession = createInitialSession(config, savedSession)
  const orbSessionId = initialSession?.id ?? randomUUID()

  // When resuming an external session with no orb-side history, look up how much
  // hidden context the model carries so the UI can reassure the user.
  let resumeInfo: ResumeInfo | undefined
  if (config.resumeSession && !config.startFresh && (initialSession?.history.length ?? 0) === 0) {
    const meta = await lookupExternalSessionMeta(config.resumeSession, config.projectPath).catch(
      () => null,
    )
    resumeInfo = {
      source: config.resumeSession.provider === 'anthropic' ? 'claude' : 'codex',
      messageCount: meta?.messageCount,
    }
  }

  const instance = render(
    React.createElement(App, {
      config,
      initialSession,
      orbSessionId,
      resumeInfo,
      onRequestRelaunch: (relaunchArgs: string[]) =>
        void relaunchOrb(relaunchArgs, () => instance.unmount()),
    }),
    {
      patchConsole: true,
      concurrent: true,
    },
  )
}
