/**
 * Shared parsing helpers extracted from existing agent implementations.
 * Used by both Anthropic and OpenAI adapters.
 */

// ── Anthropic SDK message parsing ──

export type TextBlock = { type: 'text'; text: string }
export type ToolUseBlock = {
  type: 'tool_use'
  id?: string
  tool_use_id?: string
  name: string
  input?: Record<string, unknown>
}
export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id?: string
  id?: string
  content?: unknown
  is_error?: boolean
}

export function getContentBlocks(message: unknown): unknown[] {
  if (typeof message === 'string') {
    return [{ type: 'text', text: message }]
  }
  if (!message || typeof message !== 'object') return []
  const content = (message as { content?: unknown }).content
  return Array.isArray(content) ? content : []
}

function hasType(value: unknown, type: string): value is { type: string } {
  return value !== null && typeof value === 'object' && (value as { type?: unknown }).type === type
}

export function isTextBlock(value: unknown): value is TextBlock {
  return hasType(value, 'text')
}

export function isToolUseBlock(value: unknown): value is ToolUseBlock {
  return hasType(value, 'tool_use') && typeof (value as ToolUseBlock).name === 'string'
}

export function isToolResultBlock(value: unknown): value is ToolResultBlock {
  return hasType(value, 'tool_result')
}

export function extractToolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== 'object') return ''
        const typedBlock = block as { type?: string; text?: string }
        if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
          return typedBlock.text
        }
        return ''
      })
      .join('')
  }
  if (content && typeof content === 'object' && 'text' in (content as Record<string, unknown>)) {
    return String((content as { text?: unknown }).text ?? '')
  }
  return ''
}

// ── OpenAI tool result parsing ──

export function normalizeToolInput(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, unknown>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>
      }
    } catch {
      return { value }
    }
  }
  return { value }
}

export function isToolError(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const typed = value as Record<string, unknown>
  if (typed.isError === true || typed.is_error === true) return true
  if (typeof typed.exitCode === 'number' && typed.exitCode !== 0) return true
  if (typeof typed.success === 'boolean' && typed.success === false) return true
  if (typed.error instanceof Error) return true
  if (typeof typed.error === 'string' && typed.error.length > 0) return true
  return false
}

export function formatToolResult(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return String(value ?? '')

  const typed = value as Record<string, unknown>

  const stdout = typeof typed.stdout === 'string' ? typed.stdout : ''
  const stderr = typeof typed.stderr === 'string' ? typed.stderr : ''
  if (stdout || stderr) return [stdout, stderr].filter(Boolean).join('\n').trim()

  if (typeof typed.content === 'string') return typed.content
  if (typeof typed.result === 'string') return typed.result
  if (typeof typed.success === 'boolean') return typed.success ? 'success' : 'error'

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// ── Shared ──

export function isAbortError(err: unknown): boolean {
  if (
    typeof globalThis.DOMException !== 'undefined' &&
    err instanceof globalThis.DOMException &&
    err.name === 'AbortError'
  )
    return true
  if (err instanceof Error && err.name === 'AbortError') return true
  if (err instanceof Error && err.message.includes('aborted')) return true
  return false
}
