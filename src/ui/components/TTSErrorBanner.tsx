import React from 'react'
import { Box, Text } from 'ink'
import type { TTSErrorType } from '../../types'

interface TTSErrorBannerProps {
  type: TTSErrorType
  message: string
}

const ERROR_CONFIG: Record<TTSErrorType, { icon: string; hint: string }> = {
  command_not_found: { icon: '⚠', hint: 'Install pocket-tts to enable voice output' },
  audio_playback: { icon: '🔇', hint: 'Audio playback failed' },
  generation_failed: { icon: '🔇', hint: 'Voice synthesis failed' },
  unknown: { icon: '⚠', hint: 'TTS error occurred' },
}

export function TTSErrorBanner({ type, message }: TTSErrorBannerProps) {
  const config = ERROR_CONFIG[type]

  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1} marginBottom={1}>
      <Text color="yellow">
        {config.icon} {config.hint}
        {message && type !== 'command_not_found' && <Text color="gray"> ({message})</Text>}
      </Text>
    </Box>
  )
}
