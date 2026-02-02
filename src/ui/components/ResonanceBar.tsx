import React, { memo } from 'react'
import { Box, Text } from 'ink'
import { Spinner } from '@inkjs/ui'
import type { AppState, AnthropicModel, LlmModelId, LlmProvider } from '../../types'
import { ANTHROPIC_MODELS } from '../../types'

interface ResonanceBarProps {
  status: AppState
  hasHistory?: boolean
  model: LlmModelId
  provider?: LlmProvider
  canCycleModel?: boolean
}

function StatusIndicator({ status }: { status: AppState }): React.ReactElement {
  if (status === 'speaking' || status === 'processing_speaking') {
    return (
      <>
        {status === 'processing_speaking' && <Spinner />}
        <Text color="magenta">◉</Text>
        <Text color="magenta">speaking</Text>
        <Text color="gray" dimColor>
          (esc to stop)
        </Text>
      </>
    )
  }

  if (status === 'processing') {
    return <Spinner label="thinking" />
  }

  return (
    <>
      <Text color="green">◉</Text>
      <Text color="green">ready</Text>
    </>
  )
}

const MODEL_LABELS: Record<AnthropicModel, string> = {
  'claude-haiku-4-5-20251001': 'Haiku',
  'claude-sonnet-4-5-20250929': 'Sonnet',
  'claude-opus-4-20250514': 'Opus',
}

function formatModelLabel(provider: LlmProvider, model: LlmModelId): string {
  if (provider !== 'anthropic') {
    return model
  }

  if (!ANTHROPIC_MODELS.includes(model as AnthropicModel)) {
    return model
  }

  const typedModel = model as AnthropicModel
  return MODEL_LABELS[typedModel] ?? typedModel
}

interface ModelIndicatorProps {
  model: LlmModelId
  provider: LlmProvider
  showHint: boolean
}

function ModelIndicator({ model, provider, showHint }: ModelIndicatorProps): React.ReactElement {
  const label = formatModelLabel(provider, model)

  return (
    <Box gap={1}>
      <Text color="gray" dimColor>
        model
      </Text>
      <Text color="cyan">[{label}]</Text>
      {showHint && (
        <Text color="gray" dimColor>
          Shift+Tab
        </Text>
      )}
    </Box>
  )
}

export const ResonanceBar = memo(function ResonanceBar({
  status,
  hasHistory = false,
  model,
  provider = 'anthropic',
  canCycleModel,
}: ResonanceBarProps): React.ReactNode {
  const showTranscriptHint = status === 'idle' && hasHistory
  const showCycleHint = (canCycleModel ?? status === 'idle') && provider === 'anthropic'

  return (
    <Box justifyContent="space-between" marginTop={1}>
      <Box gap={2}>
        <StatusIndicator status={status} />
        <ModelIndicator model={model} provider={provider} showHint={showCycleHint} />
      </Box>
      <Box gap={2}>
        {showTranscriptHint && (
          <Text color="gray" dimColor>
            ^O transcript
          </Text>
        )}
        <Text color="gray" dimColor>
          ^C exit
        </Text>
      </Box>
    </Box>
  )
})
