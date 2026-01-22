import React from 'react'
import { Box, Text } from 'ink'

export interface MessageBoxProps {
  role: 'you' | 'claude'
  content: string
  isError?: boolean
  width?: number
}

export const MessageBox = React.memo(function MessageBox({
  role,
  content,
  isError = false,
  width = 64,
}: MessageBoxProps) {
  const borderColor = isError ? 'red' : 'gray'
  const labelColor = role === 'you' ? 'cyan' : 'green'

  const label = ` ${role} `
  const topRightLength = Math.max(0, width - 4 - label.length)
  const topRight = '─'.repeat(topRightLength) + '┐'

  const lines = content.split('\n')

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={borderColor}>┌─</Text>
        <Text color={labelColor}>{label}</Text>
        <Text color={borderColor}>{topRight}</Text>
      </Text>
      {lines.map((line, i) => (
        <Text key={i}>
          <Text color={borderColor}>│ </Text>
          <Text color={isError ? 'red' : undefined} wrap="wrap">
            {line}
          </Text>
        </Text>
      ))}
      <Text color={borderColor}>└{'─'.repeat(width - 2)}┘</Text>
    </Box>
  )
})
