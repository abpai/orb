import React from 'react'
import { Box, Text } from 'ink'
import { Spinner } from '@inkjs/ui'
import type { AppState } from '../../types'

interface StatusBarProps {
  status: AppState
  sessionActive: boolean
}

const STATUS_CONFIG: Record<AppState, { icon: string; label: string; color: string }> = {
  idle: { icon: '◉', label: 'Ready', color: 'green' },
  processing: { icon: '', label: 'Thinking', color: 'yellow' },
  speaking: { icon: '🔊', label: 'Speaking', color: 'cyan' },
}

export function StatusBar({ status, sessionActive }: StatusBarProps) {
  const config = STATUS_CONFIG[status]

  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        {status === 'processing' ? (
          <Spinner label={config.label} />
        ) : (
          <>
            <Text color={config.color}>{config.icon}</Text>
            <Text color={config.color}>{config.label}</Text>
          </>
        )}
      </Box>
      <Box gap={1}>
        {sessionActive && <Text color="gray">Session active</Text>}
        <Text color="gray">Ctrl+C to exit</Text>
      </Box>
    </Box>
  )
}
