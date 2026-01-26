import React, { memo } from 'react'
import { Box, Text } from 'ink'
import { Spinner } from '@inkjs/ui'
import type { AppState, Model } from '../../types'

interface ResonanceBarProps {
  status: AppState
  hasHistory?: boolean
  model: Model
  canCycleModel?: boolean
}

function StatusIndicator({ status }: { status: AppState }): React.ReactNode {
  switch (status) {
    case 'speaking':
    case 'processing_speaking':
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
    case 'processing':
      return <Spinner label="thinking" />
    default:
      return (
        <>
          <Text color="green">◉</Text>
          <Text color="green">ready</Text>
        </>
      )
  }
}

const MODEL_LABELS: Record<Model, string> = {
  'claude-haiku-4-5-20251001': 'Haiku',
  'claude-sonnet-4-5-20250929': 'Sonnet',
  'claude-opus-4-20250514': 'Opus',
}

function ModelIndicator({ model, showHint }: { model: Model; showHint: boolean }): React.ReactNode {
  const label = MODEL_LABELS[model] ?? model

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
  canCycleModel,
}: ResonanceBarProps): React.ReactNode {
  const showTranscriptHint = status === 'idle' && hasHistory
  const showCycleHint = canCycleModel ?? status === 'idle'

  return (
    <Box justifyContent="space-between" marginTop={1}>
      <Box gap={2}>
        <StatusIndicator status={status} />
        <ModelIndicator model={model} showHint={showCycleHint} />
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
