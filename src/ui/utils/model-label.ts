import { labelForModel } from '../../services/model-catalog'
import type { LlmModelId, LlmProvider } from '../../types'

/**
 * Resolve a model's display label: prefer an explicit catalog-supplied label,
 * otherwise derive it from the shared taxonomy in model-catalog.
 */
export function formatModelLabel(
  provider: LlmProvider,
  model: LlmModelId,
  labels: Record<LlmModelId, string> = {},
): string {
  return labels[model] ?? labelForModel(provider, model)
}
