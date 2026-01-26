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

function parsePositiveNumber(value: string): number | undefined {
  const parsed = Number(value)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return undefined
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }
  return undefined
}

export function parseCliArgs(args: string[]): AppConfig {
  const config = { ...DEFAULT_CONFIG }

  for (const arg of args) {
    if (arg === '--new') {
      config.startFresh = true
    } else if (arg === '--no-tts') {
      config.ttsEnabled = false
    } else if (arg === '--no-streaming-tts') {
      config.ttsStreamingEnabled = false
    } else if (!arg.startsWith('-')) {
      config.projectPath = arg
    } else {
      parseArgWithValue(arg, config)
    }
  }

  return config
}

function parseArgWithValue(arg: string, config: AppConfig): void {
  const voice = getArgValue(arg, '--voice=')
  if (voice !== undefined && isValidVoice(voice)) {
    config.ttsVoice = voice
    return
  }

  const ttsMode = getArgValue(arg, '--tts-mode=')
  if (ttsMode !== undefined) {
    if (ttsMode === 'generate' || ttsMode === 'serve') {
      config.ttsMode = ttsMode
    } else if (ttsMode === 'server') {
      config.ttsMode = 'serve'
    }
    return
  }

  const serverUrl = getArgValue(arg, '--tts-server-url=')
  if (serverUrl !== undefined) {
    config.ttsServerUrl = serverUrl.trim()
    if (config.ttsMode === 'generate') {
      config.ttsMode = 'serve'
    }
    return
  }

  const speed = getArgValue(arg, '--tts-speed=')
  if (speed !== undefined) {
    const parsed = parsePositiveNumber(speed)
    if (parsed !== undefined) {
      config.ttsSpeed = parsed
    }
    return
  }

  const model = getArgValue(arg, '--model=')
  if (model !== undefined) {
    const fullModel = MODEL_ALIASES[model]
    if (fullModel) {
      config.model = fullModel
    }
    return
  }

  const bufferSentences = getArgValue(arg, '--tts-buffer-sentences=')
  if (bufferSentences !== undefined) {
    const parsed = parsePositiveInteger(bufferSentences)
    if (parsed !== undefined) {
      config.ttsBufferSentences = parsed
    }
  }
}

export { DEFAULT_CONFIG }
