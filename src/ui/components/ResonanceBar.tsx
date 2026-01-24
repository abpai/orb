import React, { memo } from 'react'
import { Box, Text } from 'ink'
import { Spinner } from '@inkjs/ui'
import type { AppState } from '../../types'

interface ResonanceBarProps {
  status: AppState
  hasHistory?: boolean
}

function StatusIndicator({ status }: { status: AppState }): React.ReactNode {
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

export const ResonanceBar = memo(function ResonanceBar({
  status,
  hasHistory = false,
}: ResonanceBarProps): React.ReactNode {
  const showTranscriptHint = status === 'idle' && hasHistory

  return (
    <Box justifyContent="space-between" marginTop={1}>
      <Box gap={1}>
        <StatusIndicator status={status} />
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
