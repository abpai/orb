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
  command_not_found: { icon: '⚠', hint: 'Install pocket-tts to enable voice output' },
  audio_playback: { icon: '🔇', hint: 'Audio playback failed' },
  generation_failed: { icon: '🔇', hint: 'Voice synthesis failed' },
  unknown: { icon: '⚠', hint: 'TTS error occurred' },
}

export function TTSErrorBanner({ type, message }: TTSErrorBannerProps): React.ReactNode {
  const { icon, hint } = ERROR_CONFIG[type]
  const showMessage = message && type !== 'command_not_found'

  return (
    <Box marginBottom={1}>
      <Text color="yellow">
        {icon} {hint}
        {showMessage && <Text color="gray"> ({message})</Text>}
      </Text>
    </Box>
  )
}
