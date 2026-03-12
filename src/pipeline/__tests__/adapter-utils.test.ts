import { describe, expect, it } from 'bun:test'
import {
  getContentBlocks,
  isTextBlock,
  isToolUseBlock,
  isToolResultBlock,
  extractToolResultText,
  normalizeToolInput,
  isToolError,
  formatToolResult,
  isAbortError,
} from '../adapters/utils'

describe('Anthropic parsing helpers', () => {
  describe('getContentBlocks', () => {
    it('wraps string messages as text blocks', () => {
      const blocks = getContentBlocks('hello')
      expect(blocks).toEqual([{ type: 'text', text: 'hello' }])
    })

    it('extracts content array from message object', () => {
      const blocks = getContentBlocks({ content: [{ type: 'text', text: 'a' }] })
      expect(blocks).toHaveLength(1)
    })

    it('returns empty for non-objects', () => {
      expect(getContentBlocks(null)).toEqual([])
      expect(getContentBlocks(undefined)).toEqual([])
      expect(getContentBlocks(42)).toEqual([])
    })
  })

  describe('isTextBlock', () => {
    it('identifies text blocks', () => {
      expect(isTextBlock({ type: 'text', text: 'hi' })).toBe(true)
      expect(isTextBlock({ type: 'tool_use', name: 'x' })).toBe(false)
    })
  })

  describe('isToolUseBlock', () => {
    it('identifies tool use blocks with name', () => {
      expect(isToolUseBlock({ type: 'tool_use', name: 'bash' })).toBe(true)
      expect(isToolUseBlock({ type: 'tool_use' })).toBe(false) // missing name
    })
  })

  describe('isToolResultBlock', () => {
    it('identifies tool result blocks', () => {
      expect(isToolResultBlock({ type: 'tool_result' })).toBe(true)
      expect(isToolResultBlock({ type: 'text' })).toBe(false)
    })
  })

  describe('extractToolResultText', () => {
    it('handles string content', () => {
      expect(extractToolResultText('hello')).toBe('hello')
    })

    it('handles array of text blocks', () => {
      const content = [
        { type: 'text', text: 'line1' },
        { type: 'text', text: 'line2' },
      ]
      expect(extractToolResultText(content)).toBe('line1line2')
    })

    it('handles object with text property', () => {
      expect(extractToolResultText({ text: 'result' })).toBe('result')
    })

    it('returns empty string for null/undefined', () => {
      expect(extractToolResultText(null)).toBe('')
      expect(extractToolResultText(undefined)).toBe('')
    })
  })
})

describe('OpenAI parsing helpers', () => {
  describe('normalizeToolInput', () => {
    it('passes objects through', () => {
      expect(normalizeToolInput({ command: 'ls' })).toEqual({ command: 'ls' })
    })

    it('parses JSON strings', () => {
      expect(normalizeToolInput('{"key":"val"}')).toEqual({ key: 'val' })
    })

    it('wraps non-JSON strings as value', () => {
      expect(normalizeToolInput('plain')).toEqual({ value: 'plain' })
    })

    it('returns empty object for falsy values', () => {
      expect(normalizeToolInput(null)).toEqual({})
      expect(normalizeToolInput(undefined)).toEqual({})
    })
  })

  describe('isToolError', () => {
    it('detects isError flag', () => {
      expect(isToolError({ isError: true })).toBe(true)
    })

    it('detects non-zero exitCode', () => {
      expect(isToolError({ exitCode: 1 })).toBe(true)
      expect(isToolError({ exitCode: 0 })).toBe(false)
    })

    it('detects success: false', () => {
      expect(isToolError({ success: false })).toBe(true)
      expect(isToolError({ success: true })).toBe(false)
    })

    it('detects error string', () => {
      expect(isToolError({ error: 'something failed' })).toBe(true)
      expect(isToolError({ error: '' })).toBe(false)
    })

    it('returns false for normal values', () => {
      expect(isToolError({ stdout: 'ok' })).toBe(false)
      expect(isToolError(null)).toBe(false)
    })
  })

  describe('formatToolResult', () => {
    it('returns string values directly', () => {
      expect(formatToolResult('hello')).toBe('hello')
    })

    it('formats stdout/stderr', () => {
      expect(formatToolResult({ stdout: 'out', stderr: 'err' })).toBe('out\nerr')
      expect(formatToolResult({ stdout: 'out' })).toBe('out')
    })

    it('formats content/result properties', () => {
      expect(formatToolResult({ content: 'data' })).toBe('data')
      expect(formatToolResult({ result: 'done' })).toBe('done')
    })

    it('falls back to JSON', () => {
      expect(formatToolResult({ key: 'val' })).toBe('{"key":"val"}')
    })
  })
})

describe('isAbortError', () => {
  it('detects DOMException AbortError', () => {
    const err = new globalThis.DOMException('aborted', 'AbortError')
    expect(isAbortError(err)).toBe(true)
  })

  it('detects Error with AbortError name', () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    expect(isAbortError(err)).toBe(true)
  })

  it('detects error messages containing abort', () => {
    expect(isAbortError(new Error('The operation was aborted'))).toBe(true)
  })

  it('returns false for normal errors', () => {
    expect(isAbortError(new Error('network failed'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })
})
