import type { AppConfig, Model, Voice } from './types'
import { DEFAULT_CONFIG, VOICES } from './types'

const MODEL_ALIASES: Record<string, Model> = {
  opus: 'claude-opus-4-20250514',
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
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

type NumberValidator = (n: number) => boolean

function parseNumber(value: string, validate: NumberValidator): number | undefined {
  const parsed = Number(value)
  return validate(parsed) ? parsed : undefined
}

const isPositiveNumber: NumberValidator = (n) => Number.isFinite(n) && n > 0
const isPositiveInteger: NumberValidator = (n) => Number.isInteger(n) && n > 0
const isNonNegativeInteger: NumberValidator = (n) => Number.isInteger(n) && n >= 0

export function parseCliArgs(args: string[]): AppConfig {
  const config = { ...DEFAULT_CONFIG }

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

    const model = getArgValue(arg, '--model=')
    if (model !== undefined) {
      config.model = MODEL_ALIASES[model] ?? config.model
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

  return config
}

export { DEFAULT_CONFIG }
