import React from 'react'
import { Box, Text } from 'ink'
import type { ToolCall } from '../../../types'

export const TOOL_INPUT_KEYS: Record<string, string> = {
  Glob: 'pattern',
  Grep: 'pattern',
  Read: 'file_path',
  Bash: 'command',
  LS: 'path',
  bash: 'command',
  readFile: 'path',
  writeFile: 'path',
}

export function truncate(text: string, maxLen: number, mode: 'start' | 'end' = 'end'): string {
  if (text.length <= maxLen) return text
  if (mode === 'start') {
    return '...' + text.slice(-(maxLen - 3))
  }
  return text.slice(0, maxLen - 3) + '...'
}

export function formatToolInput(name: string, input: Record<string, unknown>): string {
  const key = TOOL_INPUT_KEYS[name] ?? Object.keys(input)[0]
  if (!key || input[key] === undefined) {
    if ('value' in input && input.value !== undefined) {
      return truncate(String(input.value), 40, 'end')
    }
    return ''
  }

  const value = String(input[key])
  const truncateMode = name === 'Read' ? 'start' : 'end'
  return truncate(value, 40, truncateMode)
}

export interface ToolTreeProps {
  calls: ToolCall[]
}

const STATUS_CONFIG = {
  running: { icon: '⠋', color: 'yellow' },
  error: { icon: '✗', color: 'red' },
  complete: { icon: '✓', color: 'green' },
} as const

export const ToolTree = React.memo(function ToolTree({ calls }: ToolTreeProps) {
  return (
    <Box flexDirection="column" paddingLeft={3}>
      <Text color="gray">│</Text>
      {calls.map((call, i) => {
        const isLast = i === calls.length - 1
        const prefix = isLast ? '└─' : '├─'
        const inputStr = formatToolInput(call.name, call.input)
        const { icon, color: iconColor } = STATUS_CONFIG[call.status]
        const errorText =
          call.status === 'error' && call.result ? truncate(call.result, 120, 'end') : null

        return (
          <Box key={call.id} flexDirection="column">
            <Box justifyContent="space-between">
              <Text>
                <Text color="gray">{prefix} </Text>
                <Text color="cyan">{call.name}</Text>
                {inputStr && <Text color="gray"> {inputStr}</Text>}
              </Text>
              <Text color={iconColor}>{icon}</Text>
            </Box>
            {errorText && (
              <Text color="red" dimColor>
                {'  '}↳ {errorText}
              </Text>
            )}
          </Box>
        )
      })}
      <Text color="gray">│</Text>
    </Box>
  )
})
