import type { AppConfig } from './types'
import { DEFAULT_CONFIG } from './types'

const MODEL_ALIASES: Record<string, AppConfig['model']> = {
  opus: 'claude-opus-4-20250514',
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
}

const VALID_VOICES = ['alba', 'marius', 'jean'] as const

function parseArgValue(arg: string, prefix: string): string | null {
  if (!arg.startsWith(prefix)) return null
  return arg.slice(prefix.length)
}

export function parseCliArgs(args: string[]): AppConfig {
  const config = { ...DEFAULT_CONFIG }

  for (const arg of args) {
    const budget = parseArgValue(arg, '--budget=')
    if (budget !== null) {
      config.maxBudgetUsd = parseFloat(budget)
      continue
    }

    const voice = parseArgValue(arg, '--voice=')
    if (voice !== null && VALID_VOICES.includes(voice as (typeof VALID_VOICES)[number])) {
      config.ttsVoice = voice as AppConfig['ttsVoice']
      continue
    }

    const ttsMode = parseArgValue(arg, '--tts-mode=')
    if (ttsMode !== null) {
      if (ttsMode === 'generate' || ttsMode === 'serve') {
        config.ttsMode = ttsMode
      } else if (ttsMode === 'server') {
        config.ttsMode = 'serve'
      }
      continue
    }

    const serverUrl = parseArgValue(arg, '--tts-server-url=')
    if (serverUrl !== null) {
      config.ttsServerUrl = serverUrl.trim()
      if (config.ttsMode === 'generate') {
        config.ttsMode = 'serve'
      }
      continue
    }

    const speed = parseArgValue(arg, '--tts-speed=')
    if (speed !== null) {
      const parsed = Number(speed)
      if (Number.isFinite(parsed) && parsed > 0) {
        config.ttsSpeed = parsed
      }
      continue
    }

    const model = parseArgValue(arg, '--model=')
    if (model !== null) {
      const fullModel = MODEL_ALIASES[model]
      if (fullModel) {
        config.model = fullModel
      }
      continue
    }

    const bufferSentences = parseArgValue(arg, '--tts-buffer-sentences=')
    if (bufferSentences !== null) {
      const parsed = Number(bufferSentences)
      if (Number.isInteger(parsed) && parsed > 0) {
        config.ttsBufferSentences = parsed
      }
      continue
    }

    if (arg === '--no-tts') {
      config.ttsEnabled = false
    } else if (arg === '--no-streaming-tts') {
      config.ttsStreamingEnabled = false
    } else if (!arg.startsWith('-')) {
      config.projectPath = arg
    }
  }

  return config
}

export { DEFAULT_CONFIG }
