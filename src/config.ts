import type { AppConfig } from './types'
import { DEFAULT_CONFIG } from './types'

export function parseCliArgs(args: string[]): AppConfig {
  const config = { ...DEFAULT_CONFIG }

  for (const arg of args) {
    if (arg.startsWith('--budget=')) {
      config.maxBudgetUsd = parseFloat(arg.slice(9))
    } else if (arg.startsWith('--voice=')) {
      const voice = arg.slice(8) as AppConfig['ttsVoice']
      if (['alba', 'marius', 'jean'].includes(voice)) {
        config.ttsVoice = voice
      }
    } else if (arg.startsWith('--tts-mode=')) {
      const mode = arg.slice(11)
      if (mode === 'generate' || mode === 'serve') {
        config.ttsMode = mode
      } else if (mode === 'server') {
        config.ttsMode = 'serve'
      }
    } else if (arg.startsWith('--tts-server-url=')) {
      config.ttsServerUrl = arg.slice(17).trim()
      if (config.ttsMode === 'generate') {
        config.ttsMode = 'serve'
      }
    } else if (arg.startsWith('--tts-speed=')) {
      const parsed = Number(arg.slice(12))
      if (Number.isFinite(parsed) && parsed > 0) {
        config.ttsSpeed = parsed
      }
    } else if (arg.startsWith('--model=')) {
      const model = arg.slice(8)
      if (model === 'opus') {
        config.model = 'claude-opus-4-20250514'
      } else if (model === 'haiku') {
        config.model = 'claude-haiku-4-5-20251001'
      } else if (model === 'sonnet') {
        config.model = 'claude-sonnet-4-5-20250929'
      }
    } else if (arg === '--no-tts') {
      config.ttsEnabled = false
    } else if (!arg.startsWith('-')) {
      config.projectPath = arg
    }
  }

  return config
}

export { DEFAULT_CONFIG }
