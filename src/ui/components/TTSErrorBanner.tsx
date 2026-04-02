import React from 'react'
import { Box, Text } from 'ink'
import type { TTSErrorType } from '../../types'

interface TTSErrorBannerProps {
  type: TTSErrorType
  message: string
}

interface ErrorConfig {
  icon: string
  hint: string
}

const ERROR_CONFIG: Record<TTSErrorType, ErrorConfig> = {
  command_not_found: {
    icon: '⚠',
    hint: 'Voice output is unavailable',
  },
  audio_playback: { icon: '🔇', hint: 'Audio playback failed' },
  generation_failed: { icon: '🔇', hint: 'Voice synthesis failed' },
  player_not_found: { icon: '⚠', hint: 'No audio player found — install mpv: brew install mpv' },
}

export function TTSErrorBanner({ type, message }: TTSErrorBannerProps): React.ReactNode {
  const { icon, hint } = ERROR_CONFIG[type]
  const showMessage = Boolean(message)

  return (
    <Box marginBottom={1}>
      <Text color="yellow">
        {icon} {hint}
        {showMessage && <Text color="gray"> ({message})</Text>}
      </Text>
    </Box>
  )
}
