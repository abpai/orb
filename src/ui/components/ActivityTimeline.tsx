import { memo } from 'react'
import { Box, Text } from 'ink'

import type { DetailMode, ToolCall } from '../../types'
import { formatToolInput, truncate, STATUS_CONFIG } from '../utils/tool-format'
import { useTerminalSize } from '../hooks/useTerminalSize'

interface ActivityTimelineProps {
  toolCalls: ToolCall[]
  detailMode: DetailMode
  isLive?: boolean
}

function getMaxArgLen(columns: number): number {
  if (columns < 60) return 20
  if (columns < 80) return 30
  return 40
}

export const ActivityTimeline = memo(function ActivityTimeline({
  toolCalls,
  detailMode,
  isLive = false,
}: ActivityTimelineProps) {
  const { columns } = useTerminalSize()
  const maxArgLen = getMaxArgLen(columns)
  const showDetails = detailMode === 'expanded' && isLive

  if (toolCalls.length === 0) return null

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {toolCalls.map((call) => {
        const { icon, color: iconColor } = STATUS_CONFIG[call.status]
        const inputStr = formatToolInput(call.name, call.input)
        const truncatedInput = inputStr ? truncate(inputStr, maxArgLen) : ''
        const detailText =
          showDetails && call.result && call.status !== 'running'
            ? truncate(call.result, 120)
            : null

        return (
          <Box key={call.id} flexDirection="column">
            <Text>
              <Text color={iconColor}>{icon}</Text>
              <Text> </Text>
              <Text color="cyan">{call.name}</Text>
              {truncatedInput && <Text color="gray"> {truncatedInput}</Text>}
            </Text>
            {detailText && (
              <Text color={call.status === 'error' ? 'red' : 'gray'} dimColor>
                {'  '}↳ {detailText}
              </Text>
            )}
          </Box>
        )
      })}
    </Box>
  )
})
