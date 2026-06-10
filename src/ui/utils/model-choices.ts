import { FALLBACK_MODEL_CHOICES_BY_PROVIDER } from '../../services/model-catalog'
import type { AppConfig, LlmModelId } from '../../types'

/**
 * The list of models the user can cycle through: their configured choices, or
 * the provider's built-in fallback set when none are configured. Centralized so
 * the fallback expression isn't duplicated between the conversation hook and App.
 */
export function getModelChoices(config: AppConfig): LlmModelId[] {
  return config.llmModelChoices && config.llmModelChoices.length > 0
    ? config.llmModelChoices
    : FALLBACK_MODEL_CHOICES_BY_PROVIDER[config.llmProvider]
}
