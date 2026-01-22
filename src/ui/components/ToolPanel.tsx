import React from 'react'
import { Box, Text } from 'ink'
import type { ToolCall } from '../../types'

interface ToolPanelProps {
  calls: ToolCall[]
}

function formatToolInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Glob' && input.pattern) {
    return String(input.pattern)
  }
  if (name === 'Grep' && input.pattern) {
    return String(input.pattern)
  }
  if (name === 'Read' && input.file_path) {
    const path = String(input.file_path)
    return path.length > 40 ? '...' + path.slice(-37) : path
  }
  if (name === 'Bash' && input.command) {
    const cmd = String(input.command)
    return cmd.length > 40 ? cmd.slice(0, 37) + '...' : cmd
  }
  if (name === 'LS' && input.path) {
    return String(input.path)
  }

  const keys = Object.keys(input)
  const firstKey = keys[0]
  if (!firstKey) return ''
  const first = String(input[firstKey])
  return first.length > 40 ? first.slice(0, 37) + '...' : first
}

function ToolCallItem({ call }: { call: ToolCall }) {
  const inputStr = formatToolInput(call.name, call.input)

  return (
    <Box gap={1}>
      {call.status === 'running' ? (
        <Text color="yellow">⠋</Text>
      ) : call.status === 'error' ? (
        <Text color="red">✗</Text>
      ) : (
        <Text color="green">✓</Text>
      )}
      <Text color="cyan">{call.name}</Text>
      {inputStr && <Text color="gray">{inputStr}</Text>}
    </Box>
  )
}

export function ToolPanel({ calls }: ToolPanelProps) {
  if (calls.length === 0) return null

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="gray" dimColor>
        ─────────── Tool Calls ───────────
      </Text>
      <Box flexDirection="column">
        {calls.map((call) => (
          <ToolCallItem key={call.id} call={call} />
        ))}
      </Box>
    </Box>
  )
}
