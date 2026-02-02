import type { AnthropicModel, AppConfig, LlmModelId, LlmProvider, Voice } from './types'
import { ANTHROPIC_MODELS, DEFAULT_CONFIG, VOICES } from './types'

const PROVIDER_ALIASES: Record<string, LlmProvider> = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  gpt: 'openai',
}

const ANTHROPIC_MODEL_ALIASES: Record<string, AnthropicModel> = {
  opus: 'claude-opus-4-20250514',
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
}

const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, LlmModelId> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5.2-codex',
}

function getArgValue(arg: string, prefix: string): string | undefined {
  if (arg.startsWith(prefix)) {
    return arg.slice(prefix.length)
  }
  return undefined
}

function isValidVoice(value: string): value is Voice {
  return VOICES.includes(value as Voice)
}

function normalizeProvider(value: string): LlmProvider | undefined {
  const normalized = value.trim().toLowerCase()
  return PROVIDER_ALIASES[normalized]
}

function normalizeAnthropicModel(value: string): LlmModelId {
  const normalized = value.trim()
  const alias = ANTHROPIC_MODEL_ALIASES[normalized]
  if (alias) return alias
  if (ANTHROPIC_MODELS.includes(normalized as AnthropicModel)) {
    return normalized
  }
  return normalized || DEFAULT_MODEL_BY_PROVIDER.anthropic
}

function normalizeModelForProvider(provider: LlmProvider, value: string): LlmModelId {
  if (provider === 'anthropic') {
    return normalizeAnthropicModel(value)
  }
  return value.trim() || DEFAULT_MODEL_BY_PROVIDER.openai
}

type NumberValidator = (n: number) => boolean

function parseNumber(value: string, validate: NumberValidator): number | undefined {
  const parsed = Number(value)
  return validate(parsed) ? parsed : undefined
}

const isPositiveNumber: NumberValidator = (n) => Number.isFinite(n) && n > 0
const isPositiveInteger: NumberValidator = (n) => Number.isInteger(n) && n > 0
const isNonNegativeInteger: NumberValidator = (n) => Number.isInteger(n) && n >= 0

type ModelOverride = { provider?: LlmProvider; id: string }

function parseModelArg(value: string): ModelOverride | undefined {
  if (!value) return undefined

  if (!value.includes(':')) {
    return { id: value }
  }

  const [prefix, id] = value.split(':', 2)
  const trimmedPrefix = prefix?.trim() ?? ''
  const trimmedId = id?.trim() ?? ''

  if (!trimmedPrefix || !trimmedId) return undefined

  const provider = normalizeProvider(trimmedPrefix)
  return provider ? { provider, id: trimmedId } : { id: value }
}

export function parseCliArgs(args: string[]): AppConfig {
  const config = { ...DEFAULT_CONFIG }
  let providerOverride: LlmProvider | undefined
  let modelOverride: { provider?: LlmProvider; id: string } | undefined

  for (const arg of args) {
    const voice = getArgValue(arg, '--voice=')
    if (voice !== undefined && isValidVoice(voice)) {
      config.ttsVoice = voice
      continue
    }

    const ttsMode = getArgValue(arg, '--tts-mode=')
    if (ttsMode !== undefined) {
      if (ttsMode === 'generate' || ttsMode === 'serve') {
        config.ttsMode = ttsMode
      } else if (ttsMode === 'server') {
        config.ttsMode = 'serve'
      }
      continue
    }

    const serverUrl = getArgValue(arg, '--tts-server-url=')
    if (serverUrl !== undefined) {
      config.ttsServerUrl = serverUrl.trim()
      if (config.ttsMode === 'generate') {
        config.ttsMode = 'serve'
      }
      continue
    }

    const speed = getArgValue(arg, '--tts-speed=')
    if (speed !== undefined) {
      config.ttsSpeed = parseNumber(speed, isPositiveNumber) ?? config.ttsSpeed
      continue
    }

    const openaiApi = getArgValue(arg, '--openai-api=')
    if (openaiApi !== undefined) {
      const normalized = openaiApi.trim().toLowerCase()
      if (normalized === 'chat' || normalized === 'responses') {
        config.openaiApi = normalized
      }
      continue
    }

    const provider = getArgValue(arg, '--provider=') ?? getArgValue(arg, '--llm-provider=')
    if (provider !== undefined) {
      const normalized = normalizeProvider(provider)
      if (normalized) {
        providerOverride = normalized
      }
      continue
    }

    const model = getArgValue(arg, '--model=')
    if (model !== undefined) {
      const parsed = parseModelArg(model.trim())
      if (parsed) modelOverride = parsed
      continue
    }

    const bufferSentences = getArgValue(arg, '--tts-buffer-sentences=')
    if (bufferSentences !== undefined) {
      config.ttsBufferSentences =
        parseNumber(bufferSentences, isPositiveInteger) ?? config.ttsBufferSentences
      continue
    }

    const minChunkLength = getArgValue(arg, '--tts-min-chunk-length=')
    if (minChunkLength !== undefined) {
      config.ttsMinChunkLength =
        parseNumber(minChunkLength, isNonNegativeInteger) ?? config.ttsMinChunkLength
      continue
    }

    const maxWaitMs = getArgValue(arg, '--tts-max-wait-ms=')
    if (maxWaitMs !== undefined) {
      config.ttsMaxWaitMs = parseNumber(maxWaitMs, isNonNegativeInteger) ?? config.ttsMaxWaitMs
      continue
    }

    const graceWindowMs = getArgValue(arg, '--tts-grace-window-ms=')
    if (graceWindowMs !== undefined) {
      config.ttsGraceWindowMs =
        parseNumber(graceWindowMs, isNonNegativeInteger) ?? config.ttsGraceWindowMs
      continue
    }

    if (arg === '--new') {
      config.startFresh = true
    } else if (arg === '--openai-login') {
      config.openaiLogin = true
    } else if (arg === '--openai-device-login' || arg === '--openai-device-auth') {
      config.openaiDeviceLogin = true
    } else if (arg === '--no-tts') {
      config.ttsEnabled = false
    } else if (arg === '--no-streaming-tts') {
      config.ttsStreamingEnabled = false
    } else if (arg === '--tts-clause-boundaries') {
      config.ttsClauseBoundaries = true
    } else if (arg === '--no-tts-clause-boundaries') {
      config.ttsClauseBoundaries = false
    } else if (!arg.startsWith('-')) {
      config.projectPath = arg
    }
  }

  if (modelOverride?.provider) {
    config.llmProvider = modelOverride.provider
  } else if (providerOverride) {
    config.llmProvider = providerOverride
  }

  if (modelOverride) {
    config.llmModel = resolveModelForConfig(config.llmProvider, modelOverride.id)
  } else if (providerOverride) {
    config.llmModel = DEFAULT_MODEL_BY_PROVIDER[config.llmProvider]
  }

  return config
}

function isAnthropicModel(value: string): boolean {
  return ANTHROPIC_MODELS.includes(value as AnthropicModel) || value in ANTHROPIC_MODEL_ALIASES
}

function resolveModelForConfig(provider: LlmProvider, modelId: string): LlmModelId {
  const normalized = normalizeModelForProvider(provider, modelId)

  // Prevent Anthropic models from being used with OpenAI provider
  if (provider === 'openai' && isAnthropicModel(normalized)) {
    return DEFAULT_MODEL_BY_PROVIDER.openai
  }

  return normalized
}

export { DEFAULT_CONFIG, DEFAULT_MODEL_BY_PROVIDER }
