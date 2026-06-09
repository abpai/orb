import { randomUUID } from 'node:crypto'
import os from 'node:os'

import {
  DEFAULT_CONFIG,
  DEFAULT_MODEL_ALIAS_BY_PROVIDER,
  parseCliArgs,
  resolveModelForConfig,
} from '../config'
import type { AgentSession, AppConfig, ResumeInfo, SavedSession } from '../types'
import { applyGlobalConfig, getGlobalConfigPath, loadGlobalConfig } from './global-config'
import { warn } from './log'
import { resolveAppModelConfig } from './model-catalog'
import { modelCachePath } from './orb-paths'
import { applyOpenAiStreamingDefaults, resolveSmartProvider } from './provider-defaults'
import { loadSession, loadSessionById } from './session'
import { lookupExternalSessionMeta } from './external-sessions'

export interface StartupError {
  kind: 'error'
  message: string
  code: number
}

export interface RuntimeConfig {
  kind: 'ok'
  config: AppConfig
  initialSession: SavedSession | null
  orbSessionId: string
  resumeInfo?: ResumeInfo
}

function sameAgentSession(a: AgentSession | undefined, b: AgentSession): boolean {
  if (!a || a.provider !== b.provider) return false
  // ubs:ignore not-a-secret — sessionId/threadId are public CLI-supplied lookup keys, not bearer tokens or HMACs
  if (a.provider === 'anthropic' && b.provider === 'anthropic') return a.sessionId === b.sessionId
  if (a.provider === 'openai' && b.provider === 'openai') return a.threadId === b.threadId
  return false
}

function alignSavedSessionWithConfig(session: SavedSession, config: AppConfig): SavedSession {
  const agentSession =
    session.agentSession?.provider === config.llmProvider ? session.agentSession : undefined

  return {
    ...session,
    projectPath: config.projectPath,
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
    agentSession,
  }
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

/**
 * Resolve all startup configuration from raw CLI args. Returns a fully-resolved
 * config, session, and resume metadata — or a structured StartupError with a
 * message and exit code. Contains no process.exit calls; all error paths surface
 * as a discriminated union so callers can handle them uniformly and the logic is
 * unit-testable without process-exit mocking.
 */
export async function resolveRuntimeConfig(
  args: string[],
  homeDir = os.homedir(),
): Promise<RuntimeConfig | StartupError> {
  const globalConfig = await loadGlobalConfig(getGlobalConfigPath(homeDir))
  for (const warning of globalConfig.warnings) {
    warn(warning)
  }

  const baseConfig = applyGlobalConfig(DEFAULT_CONFIG, globalConfig.config)
  const { config, explicit, cliExplicit, cliOverrides } = parseCliArgs(args, {
    baseConfig,
    baseExplicit: globalConfig.explicit,
  })

  let resumeById: SavedSession | null = null
  if (config.resumeId && !config.startFresh) {
    resumeById = await loadSessionById(config.projectPath, config.resumeId, homeDir)
    if (!resumeById) {
      return {
        kind: 'error',
        message: `No saved session "${config.resumeId}" found for ${config.projectPath}.`,
        code: 1,
      }
    }
    const resumeProvider = cliOverrides.provider ?? resumeById.llmProvider
    config.llmProvider = resumeProvider
    if (cliExplicit.model && cliOverrides.model) {
      config.llmModel = resolveModelForConfig(resumeProvider, cliOverrides.model)
    } else if (!cliExplicit.provider) {
      config.llmModel = resumeById.llmModel
    }
  }
  const resumeLocksProvider = resumeById !== null

  if (!explicit.provider && !explicit.model && !resumeLocksProvider) {
    const smartProvider = await resolveSmartProvider(config)
    if (!smartProvider) {
      return {
        kind: 'error',
        message:
          'No available LLM credentials found. Set up Claude (Max/OAuth), Codex ChatGPT login, GOOGLE_GENERATIVE_AI_API_KEY, or ANTHROPIC_API_KEY before starting.\n' +
          'Tip: Use --provider openai after `codex login --device-auth`, or --provider gemini with GOOGLE_GENERATIVE_AI_API_KEY.',
        code: 1,
      }
    }
    config.llmProvider = smartProvider.provider
    if (!explicit.model) {
      config.llmModel = DEFAULT_MODEL_ALIAS_BY_PROVIDER[smartProvider.provider]
    }
  }

  const resolvedModel = await resolveAppModelConfig(config, { cachePath: modelCachePath(homeDir) })
  config.llmModel = resolvedModel.llmModel
  config.llmModelChoices = resolvedModel.llmModelChoices
  config.llmModelLabels = resolvedModel.llmModelLabels
  if (resolvedModel.catalog.warning) {
    warn(`Model catalog refresh failed: ${resolvedModel.catalog.warning}`)
  }

  applyOpenAiStreamingDefaults(config, explicit)

  const savedSession = resumeById
    ? alignSavedSessionWithConfig(resumeById, config)
    : config.startFresh
      ? null
      : await loadSession(config.projectPath, homeDir)
  const initialSession = createInitialSession(config, savedSession)
  const orbSessionId = initialSession?.id ?? randomUUID()

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

  return { kind: 'ok', config, initialSession, orbSessionId, resumeInfo }
}
