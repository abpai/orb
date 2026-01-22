import React from 'react'
import { Box, Text } from 'ink'

interface ResponsePanelProps {
  text: string
  maxLines?: number
}

export function ResponsePanel({ text, maxLines = 15 }: ResponsePanelProps) {
  if (!text) return null

  const lines = text.split('\n')
  const displayLines = maxLines > 0 && lines.length > maxLines ? lines.slice(-maxLines) : lines
  const truncated = maxLines > 0 && lines.length > maxLines

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="gray" dimColor>
        ─────────── Response ───────────
      </Text>
      {truncated && (
        <Text color="gray" dimColor>
          ... ({lines.length - maxLines} lines above)
        </Text>
      )}
      <Box flexDirection="column">
        {displayLines.map((line, i) => (
          <Text key={i} wrap="wrap">
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  )
}
