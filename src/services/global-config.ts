import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse, stringify } from '@iarna/toml'
import { DEFAULT_MODEL_ALIAS_BY_PROVIDER, type ExplicitFlags } from '../config'
import {
  REASONING_EFFORTS,
  VOICES,
  type AppConfig,
  type LlmModelId,
  type LlmProvider,
  type ReasoningEffort,
  type Voice,
} from '../types'
import { globalConfigPath, isFileNotFoundError } from './orb-paths'

interface OrbGlobalTtsConfig {
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
  reasoningEffort?: ReasoningEffort
  skipIntro?: boolean
  tts?: OrbGlobalTtsConfig
}

interface LoadGlobalConfigResult {
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
  if (value === 'anthropic' || value === 'openai' || value === 'gemini') return value
  warnings.push(`${label} must be "anthropic", "openai", or "gemini".`)
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

function validateReasoningEffort(
  value: unknown,
  label: string,
  warnings: string[],
): ReasoningEffort | undefined {
  if (typeof value === 'string' && REASONING_EFFORTS.includes(value as ReasoningEffort)) {
    return value as ReasoningEffort
  }
  warnings.push(`${label} must be one of: ${REASONING_EFFORTS.join(', ')}.`)
  return undefined
}

export function getGlobalConfigPath(homeDir = os.homedir()): string {
  return globalConfigPath(homeDir)
}

// ── Field descriptors ────────────────────────────────────────────────────────
//
// A single descriptor entry drives parse, apply, and serialize for each field.
// Adding a new config key is one new entry; the three functions below never need
// to be touched.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ValidateFn = (raw: unknown, label: string, warnings: string[]) => any

interface RootField {
  tomlKey: string
  orbKey: keyof OrbGlobalConfig
  validate: ValidateFn
  explicitFlag?: keyof ExplicitFlags
  apply(appConfig: AppConfig, value: unknown, orbConfig: OrbGlobalConfig): void
}

interface TtsField {
  tomlKey: string
  orbKey: keyof OrbGlobalTtsConfig
  appKey: keyof AppConfig
  validate: ValidateFn
  explicitFlag?: keyof ExplicitFlags
}

const ROOT_FIELDS: RootField[] = [
  {
    tomlKey: 'provider',
    orbKey: 'provider',
    validate: validateProvider,
    explicitFlag: 'provider',
    apply(c, v, orb) {
      c.llmProvider = v as LlmProvider
      if (!orb.model) c.llmModel = DEFAULT_MODEL_ALIAS_BY_PROVIDER[v as LlmProvider]
    },
  },
  {
    tomlKey: 'model',
    orbKey: 'model',
    validate: validateString,
    explicitFlag: 'model',
    apply(c, v) {
      c.llmModel = v as string
    },
  },
  {
    tomlKey: 'reasoning_effort',
    orbKey: 'reasoningEffort',
    validate: validateReasoningEffort,
    apply(c, v) {
      c.llmReasoningEffort = v as ReasoningEffort
    },
  },
  {
    tomlKey: 'skip_intro',
    orbKey: 'skipIntro',
    validate: validateBoolean,
    apply(c, v) {
      c.skipIntro = v as boolean
    },
  },
]

const TTS_FIELDS: TtsField[] = [
  { tomlKey: 'enabled', orbKey: 'enabled', appKey: 'ttsEnabled', validate: validateBoolean },
  {
    tomlKey: 'streaming',
    orbKey: 'streaming',
    appKey: 'ttsStreamingEnabled',
    validate: validateBoolean,
  },
  { tomlKey: 'mode', orbKey: 'mode', appKey: 'ttsMode', validate: validateTtsMode },
  { tomlKey: 'server_url', orbKey: 'serverUrl', appKey: 'ttsServerUrl', validate: validateString },
  { tomlKey: 'voice', orbKey: 'voice', appKey: 'ttsVoice', validate: validateVoice },
  { tomlKey: 'speed', orbKey: 'speed', appKey: 'ttsSpeed', validate: validatePositiveNumber },
  {
    tomlKey: 'buffer_sentences',
    orbKey: 'bufferSentences',
    appKey: 'ttsBufferSentences',
    validate: validatePositiveInt,
    explicitFlag: 'ttsBufferSentences',
  },
  {
    tomlKey: 'clause_boundaries',
    orbKey: 'clauseBoundaries',
    appKey: 'ttsClauseBoundaries',
    validate: validateBoolean,
    explicitFlag: 'ttsClauseBoundaries',
  },
  {
    tomlKey: 'min_chunk_length',
    orbKey: 'minChunkLength',
    appKey: 'ttsMinChunkLength',
    validate: validateNonNegativeInt,
    explicitFlag: 'ttsMinChunkLength',
  },
  {
    tomlKey: 'max_wait_ms',
    orbKey: 'maxWaitMs',
    appKey: 'ttsMaxWaitMs',
    validate: validateNonNegativeInt,
    explicitFlag: 'ttsMaxWaitMs',
  },
  {
    tomlKey: 'grace_window_ms',
    orbKey: 'graceWindowMs',
    appKey: 'ttsGraceWindowMs',
    validate: validateNonNegativeInt,
    explicitFlag: 'ttsGraceWindowMs',
  },
]

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

  for (const field of ROOT_FIELDS) {
    if (!(field.tomlKey in root)) continue
    const value = field.validate(root[field.tomlKey], field.tomlKey, warnings)
    if (value !== undefined) {
      ;(config as Record<string, unknown>)[field.orbKey] = value
      if (field.explicitFlag) explicit[field.explicitFlag] = true
    }
  }

  if ('tts' in root) {
    const rawTts = asObject(root.tts)
    if (!rawTts) {
      warnings.push('tts must be a table.')
    } else {
      const tts: OrbGlobalTtsConfig = {}
      for (const field of TTS_FIELDS) {
        if (!(field.tomlKey in rawTts)) continue
        const value = field.validate(rawTts[field.tomlKey], `tts.${field.tomlKey}`, warnings)
        if (value !== undefined) {
          ;(tts as Record<string, unknown>)[field.orbKey] = value
          if (field.explicitFlag) explicit[field.explicitFlag] = true
        }
      }
      if (Object.keys(tts).length > 0) config.tts = tts
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
    if (isFileNotFoundError(error)) {
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

  for (const field of ROOT_FIELDS) {
    const value = globalConfig[field.orbKey]
    if (value !== undefined) field.apply(nextConfig, value, globalConfig)
  }

  if (globalConfig.tts) {
    const tts = globalConfig.tts
    for (const field of TTS_FIELDS) {
      const value = tts[field.orbKey]
      if (value !== undefined) {
        ;(nextConfig as unknown as Record<string, unknown>)[field.appKey] = value
      }
    }
  }

  return nextConfig
}

export function serializeGlobalConfig(config: OrbGlobalConfig): string {
  const document: RawObject = {}

  for (const field of ROOT_FIELDS) {
    const value = config[field.orbKey]
    if (value !== undefined) document[field.tomlKey] = value
  }

  if (config.tts) {
    const tts: RawObject = {}
    for (const field of TTS_FIELDS) {
      const value = config.tts[field.orbKey]
      if (value !== undefined) tts[field.tomlKey] = value
    }
    if (Object.keys(tts).length > 0) document.tts = tts
  }

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
