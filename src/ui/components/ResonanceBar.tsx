import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { Spinner } from '@inkjs/ui'
import type { AppState } from '../../types'

interface ResonanceBarProps {
  status: AppState
  hasHistory?: boolean
}

const WAVE_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const WAVE_LENGTH = 15

function generateWave(offset: number): string {
  return Array.from({ length: WAVE_LENGTH }, (_, i) => {
    const index = Math.floor(Math.abs(Math.sin((i + offset) * 0.4) * 7))
    return WAVE_CHARS[index]
  }).join('')
}

interface StatusIndicatorProps {
  status: AppState
  waveOffset: number
}

function StatusIndicator({ status, waveOffset }: StatusIndicatorProps): React.ReactNode {
  if (status === 'speaking' || status === 'processing_speaking') {
    return (
      <>
        {status === 'processing_speaking' && <Spinner />}
        <Text color="cyan">{generateWave(waveOffset)}</Text>
        <Text color="cyan">speaking</Text>
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

function isSpeakingState(status: AppState): boolean {
  return status === 'speaking' || status === 'processing_speaking'
}

export function ResonanceBar({ status, hasHistory = false }: ResonanceBarProps): React.ReactNode {
  const [waveOffset, setWaveOffset] = useState(0)
  const speaking = isSpeakingState(status)

  useEffect(() => {
    if (!speaking) return
    const interval = setInterval(() => setWaveOffset((o) => o + 1), 80)
    return () => clearInterval(interval)
  }, [speaking])

  const showTranscriptHint = status === 'idle' && hasHistory

  return (
    <Box justifyContent="space-between" marginTop={1}>
      <Box gap={1}>
        <StatusIndicator status={status} waveOffset={waveOffset} />
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
}
