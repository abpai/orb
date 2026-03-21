import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, stringify } from '@iarna/toml'
import { DEFAULT_MODEL_BY_PROVIDER, type ExplicitFlags } from '../config'
import { VOICES, type AppConfig, type LlmModelId, type LlmProvider, type Voice } from '../types'

const CONFIG_DIR = '.orb'
const CONFIG_FILE = 'config.toml'

export interface OrbGlobalTtsConfig {
  enabled?: boolean
  streaming?: boolean
  mode?: AppConfig['ttsMode']
  serverUrl?: string
  voice?: Voice
  speed?: number
  bufferSentences?: number
  clauseBoundaries?: boolean
  minChunkLength?: number
  maxWaitMs?: number
  graceWindowMs?: number
}

export interface OrbGlobalConfig {
  provider?: LlmProvider
  model?: LlmModelId
  skipIntro?: boolean
  tts?: OrbGlobalTtsConfig
}

export interface LoadGlobalConfigResult {
  config: OrbGlobalConfig
  explicit: Partial<ExplicitFlags>
  warnings: string[]
  path: string
  exists: boolean
}

type RawObject = Record<string, unknown>

function asObject(value: unknown): RawObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RawObject) : null
}

function validateString(value: unknown, label: string, warnings: string[]): string | undefined {
  if (typeof value !== 'string') {
    warnings.push(`${label} must be a string.`)
    return undefined
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    warnings.push(`${label} must not be empty.`)
    return undefined
  }

  return trimmed
}

function validateBoolean(value: unknown, label: string, warnings: string[]): boolean | undefined {
  if (typeof value !== 'boolean') {
    warnings.push(`${label} must be true or false.`)
    return undefined
  }

  return value
}

function validatePositiveNumber(
  value: unknown,
  label: string,
  warnings: string[],
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    warnings.push(`${label} must be a positive number.`)
    return undefined
  }

  return value
}

function validatePositiveInt(
  value: unknown,
  label: string,
  warnings: string[],
): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    warnings.push(`${label} must be a positive integer.`)
    return undefined
  }

  return value
}

function validateNonNegativeInt(
  value: unknown,
  label: string,
  warnings: string[],
): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    warnings.push(`${label} must be a non-negative integer.`)
    return undefined
  }

  return value
}

function validateProvider(
  value: unknown,
  label: string,
  warnings: string[],
): LlmProvider | undefined {
  if (value === 'anthropic' || value === 'openai') return value
  warnings.push(`${label} must be "anthropic" or "openai".`)
  return undefined
}

function validateTtsMode(
  value: unknown,
  label: string,
  warnings: string[],
): AppConfig['ttsMode'] | undefined {
  if (value === 'generate' || value === 'serve') return value
  warnings.push(`${label} must be "generate" or "serve".`)
  return undefined
}

function validateVoice(value: unknown, label: string, warnings: string[]): Voice | undefined {
  if (typeof value !== 'string' || !VOICES.includes(value as Voice)) {
    warnings.push(`${label} must be one of: ${VOICES.join(', ')}.`)
    return undefined
  }

  return value as Voice
}

export function getGlobalConfigPath(homeDir = os.homedir()): string {
  return path.join(homeDir, CONFIG_DIR, CONFIG_FILE)
}

export function parseGlobalConfigToml(
  contents: string,
  configPath = getGlobalConfigPath(),
): Omit<LoadGlobalConfigResult, 'path' | 'exists'> {
  const warnings: string[] = []
  const config: OrbGlobalConfig = {}
  const explicit: Partial<ExplicitFlags> = {}

  let parsed: unknown
  try {
    parsed = parse(contents)
  } catch (error) {
    warnings.push(
      `Failed to parse Orb config "${configPath}": ${error instanceof Error ? error.message : String(error)}`,
    )
    return { config, explicit, warnings }
  }

  const root = asObject(parsed)
  if (!root) {
    warnings.push(`Orb config "${configPath}" must contain a TOML table.`)
    return { config, explicit, warnings }
  }

  if ('provider' in root) {
    const provider = validateProvider(root.provider, 'provider', warnings)
    if (provider) {
      config.provider = provider
      explicit.provider = true
    }
  }

  if ('model' in root) {
    const model = validateString(root.model, 'model', warnings)
    if (model) {
      config.model = model
      explicit.model = true
    }
  }

  if ('skip_intro' in root) {
    const skipIntro = validateBoolean(root.skip_intro, 'skip_intro', warnings)
    if (skipIntro !== undefined) {
      config.skipIntro = skipIntro
    }
  }

  if ('tts' in root) {
    const rawTts = asObject(root.tts)
    if (!rawTts) {
      warnings.push('tts must be a table.')
    } else {
      const tts: OrbGlobalTtsConfig = {}

      if ('enabled' in rawTts) {
        const value = validateBoolean(rawTts.enabled, 'tts.enabled', warnings)
        if (value !== undefined) tts.enabled = value
      }
      if ('streaming' in rawTts) {
        const value = validateBoolean(rawTts.streaming, 'tts.streaming', warnings)
        if (value !== undefined) tts.streaming = value
      }
      if ('mode' in rawTts) {
        const value = validateTtsMode(rawTts.mode, 'tts.mode', warnings)
        if (value) tts.mode = value
      }
      if ('server_url' in rawTts) {
        const value = validateString(rawTts.server_url, 'tts.server_url', warnings)
        if (value) tts.serverUrl = value
      }
      if ('voice' in rawTts) {
        const value = validateVoice(rawTts.voice, 'tts.voice', warnings)
        if (value) tts.voice = value
      }
      if ('speed' in rawTts) {
        const value = validatePositiveNumber(rawTts.speed, 'tts.speed', warnings)
        if (value !== undefined) tts.speed = value
      }
      if ('buffer_sentences' in rawTts) {
        const value = validatePositiveInt(rawTts.buffer_sentences, 'tts.buffer_sentences', warnings)
        if (value !== undefined) {
          tts.bufferSentences = value
          explicit.ttsBufferSentences = true
        }
      }
      if ('clause_boundaries' in rawTts) {
        const value = validateBoolean(rawTts.clause_boundaries, 'tts.clause_boundaries', warnings)
        if (value !== undefined) {
          tts.clauseBoundaries = value
          explicit.ttsClauseBoundaries = true
        }
      }
      if ('min_chunk_length' in rawTts) {
        const value = validateNonNegativeInt(
          rawTts.min_chunk_length,
          'tts.min_chunk_length',
          warnings,
        )
        if (value !== undefined) {
          tts.minChunkLength = value
          explicit.ttsMinChunkLength = true
        }
      }
      if ('max_wait_ms' in rawTts) {
        const value = validateNonNegativeInt(rawTts.max_wait_ms, 'tts.max_wait_ms', warnings)
        if (value !== undefined) {
          tts.maxWaitMs = value
          explicit.ttsMaxWaitMs = true
        }
      }
      if ('grace_window_ms' in rawTts) {
        const value = validateNonNegativeInt(
          rawTts.grace_window_ms,
          'tts.grace_window_ms',
          warnings,
        )
        if (value !== undefined) {
          tts.graceWindowMs = value
          explicit.ttsGraceWindowMs = true
        }
      }

      if (Object.keys(tts).length > 0) {
        config.tts = tts
      }
    }
  }

  return { config, explicit, warnings }
}

export async function loadGlobalConfig(
  configPath = getGlobalConfigPath(),
): Promise<LoadGlobalConfigResult> {
  try {
    const contents = await fs.readFile(configPath, 'utf8')
    const parsed = parseGlobalConfigToml(contents, configPath)
    return { ...parsed, path: configPath, exists: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: {}, explicit: {}, warnings: [], path: configPath, exists: false }
    }

    return {
      config: {},
      explicit: {},
      warnings: [
        `Failed to read Orb config "${configPath}": ${error instanceof Error ? error.message : String(error)}`,
      ],
      path: configPath,
      exists: false,
    }
  }
}

export function applyGlobalConfig(baseConfig: AppConfig, globalConfig: OrbGlobalConfig): AppConfig {
  const nextConfig: AppConfig = { ...baseConfig }

  if (globalConfig.provider) {
    nextConfig.llmProvider = globalConfig.provider
    if (!globalConfig.model) {
      nextConfig.llmModel = DEFAULT_MODEL_BY_PROVIDER[globalConfig.provider]
    }
  }

  if (globalConfig.model) nextConfig.llmModel = globalConfig.model
  if (globalConfig.skipIntro !== undefined) nextConfig.skipIntro = globalConfig.skipIntro

  if (globalConfig.tts) {
    const tts = globalConfig.tts
    if (tts.enabled !== undefined) nextConfig.ttsEnabled = tts.enabled
    if (tts.streaming !== undefined) nextConfig.ttsStreamingEnabled = tts.streaming
    if (tts.mode) nextConfig.ttsMode = tts.mode
    if (tts.serverUrl) nextConfig.ttsServerUrl = tts.serverUrl
    if (tts.voice) nextConfig.ttsVoice = tts.voice
    if (tts.speed !== undefined) nextConfig.ttsSpeed = tts.speed
    if (tts.bufferSentences !== undefined) nextConfig.ttsBufferSentences = tts.bufferSentences
    if (tts.clauseBoundaries !== undefined) nextConfig.ttsClauseBoundaries = tts.clauseBoundaries
    if (tts.minChunkLength !== undefined) nextConfig.ttsMinChunkLength = tts.minChunkLength
    if (tts.maxWaitMs !== undefined) nextConfig.ttsMaxWaitMs = tts.maxWaitMs
    if (tts.graceWindowMs !== undefined) nextConfig.ttsGraceWindowMs = tts.graceWindowMs
  }

  return nextConfig
}

export function serializeGlobalConfig(config: OrbGlobalConfig): string {
  const document: RawObject = {}

  if (config.provider) document.provider = config.provider
  if (config.model) document.model = config.model
  if (config.skipIntro !== undefined) document.skip_intro = config.skipIntro

  if (config.tts) {
    const tts: RawObject = {}
    if (config.tts.enabled !== undefined) tts.enabled = config.tts.enabled
    if (config.tts.streaming !== undefined) tts.streaming = config.tts.streaming
    if (config.tts.mode) tts.mode = config.tts.mode
    if (config.tts.serverUrl) tts.server_url = config.tts.serverUrl
    if (config.tts.voice) tts.voice = config.tts.voice
    if (config.tts.speed !== undefined) tts.speed = config.tts.speed
    if (config.tts.bufferSentences !== undefined) tts.buffer_sentences = config.tts.bufferSentences
    if (config.tts.clauseBoundaries !== undefined)
      tts.clause_boundaries = config.tts.clauseBoundaries
    if (config.tts.minChunkLength !== undefined) tts.min_chunk_length = config.tts.minChunkLength
    if (config.tts.maxWaitMs !== undefined) tts.max_wait_ms = config.tts.maxWaitMs
    if (config.tts.graceWindowMs !== undefined) tts.grace_window_ms = config.tts.graceWindowMs
    if (Object.keys(tts).length > 0) document.tts = tts
  }

  // @iarna/toml expects JsonMap; our RawObject is structurally compatible at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stringify(document as any)
}

export async function writeGlobalConfig(
  config: OrbGlobalConfig,
  configPath = getGlobalConfigPath(),
): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await Bun.write(configPath, serializeGlobalConfig(config))
}
