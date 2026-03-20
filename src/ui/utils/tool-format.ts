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

export const STATUS_CONFIG = {
  running: { icon: '⠋', color: 'yellow' },
  error: { icon: '✗', color: 'red' },
  complete: { icon: '✓', color: 'green' },
} as const

export type ToolStatus = keyof typeof STATUS_CONFIG
