import type { LlmModelId, LlmProvider } from '../../types'

function titleCaseWords(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => {
      const upper = part.toUpperCase()
      if (upper === 'GPT') return upper
      if (/^\d+(?:\.\d+)?$/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

function formatAnthropicModel(model: string): string {
  const family = model.match(/^claude-(haiku|sonnet|opus)-/)?.[1]
  if (!family) return model

  const version = model.match(/-(\d)-(\d)(?:-|$)/)
  const familyLabel = family.charAt(0).toUpperCase() + family.slice(1)
  return version ? `${familyLabel} ${version[1]}.${version[2]}` : familyLabel
}

export function formatModelLabel(
  provider: LlmProvider,
  model: LlmModelId,
  labels: Record<LlmModelId, string> = {},
): string {
  const explicit = labels[model]
  if (explicit) return explicit

  if (provider === 'anthropic') return formatAnthropicModel(model)
  if (provider === 'openai' && model.startsWith('gpt-')) {
    return `GPT ${titleCaseWords(model.slice('gpt-'.length))}`
  }
  if (provider === 'gemini' && model.startsWith('gemini-')) {
    return `Gemini ${titleCaseWords(model.slice('gemini-'.length))}`
  }
  return model
}
