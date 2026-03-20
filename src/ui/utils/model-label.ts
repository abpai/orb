import type { AnthropicModel, LlmModelId, LlmProvider } from '../../types'
import { ANTHROPIC_MODELS } from '../../types'

export const MODEL_LABELS: Record<AnthropicModel, string> = {
  'claude-haiku-4-5-20251001': 'Haiku',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-opus-4-5-20251101': 'Opus 4.5',
  'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
  'claude-opus-4-1-20250805': 'Opus 4.1',
  'claude-opus-4-20250514': 'Opus 4',
  'claude-sonnet-4-20250514': 'Sonnet 4',
  'claude-3-haiku-20240307': 'Haiku 3',
}

export function formatModelLabel(provider: LlmProvider, model: LlmModelId): string {
  if (provider !== 'anthropic') return model
  if (!ANTHROPIC_MODELS.includes(model as AnthropicModel)) return model
  return MODEL_LABELS[model as AnthropicModel] ?? model
}
