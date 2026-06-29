import { beforeEach, describe, expect, it } from 'bun:test'

import { DEFAULT_CONFIG } from '../../types'
import { resetFrameIds } from '../frames'
import {
  buildCursorAgentCommand,
  createCursorStreamMapper,
  formatCursorPrompt,
  resolveCursorAgentBinary,
} from './cursor'

describe('Cursor adapter command construction', () => {
  it('uses read-only ask mode by default and passes the prompt last', () => {
    const cmd = buildCursorAgentCommand({
      appConfig: {
        ...DEFAULT_CONFIG,
        projectPath: '/repo/orb',
        llmProvider: 'cursor',
        llmModel: 'composer-2.5-fast',
      },
      prompt: 'hello cursor',
    })

    expect(cmd[0]).toBe('agent')
    expect(cmd).toContain('--mode')
    expect(cmd).toContain('ask')
    expect(cmd).toContain('--workspace')
    expect(cmd).toContain('/repo/orb')
    expect(cmd).toContain('--stream-partial-output')
    expect(cmd.at(-1)).toBe('hello cursor')
  })

  it('switches to force mode for yolo and resumes cursor sessions', () => {
    const cmd = buildCursorAgentCommand({
      appConfig: {
        ...DEFAULT_CONFIG,
        projectPath: '/repo/orb',
        llmProvider: 'cursor',
        llmModel: 'composer-2.5',
        yolo: true,
      },
      session: { provider: 'cursor', sessionId: 'cursor-session-1' },
      prompt: 'continue',
    })

    expect(cmd).toContain('--force')
    expect(cmd).toContain('--approve-mcps')
    expect(cmd).not.toContain('--mode')
    expect(cmd).toContain('--resume')
    expect(cmd).toContain('cursor-session-1')
  })

  it('can build commands with the cursor-agent fallback binary', () => {
    const cmd = buildCursorAgentCommand({
      appConfig: {
        ...DEFAULT_CONFIG,
        projectPath: '/repo/orb',
        llmProvider: 'cursor',
        llmModel: 'composer-2.5-fast',
      },
      binary: 'cursor-agent',
      prompt: 'hello cursor',
    })

    expect(cmd[0]).toBe('cursor-agent')
  })

  it('prefers agent and falls back to cursor-agent when resolving the CLI binary', () => {
    expect(resolveCursorAgentBinary((binary) => (binary === 'agent' ? '/bin/agent' : null))).toBe(
      'agent',
    )
    expect(
      resolveCursorAgentBinary((binary) =>
        binary === 'cursor-agent' ? '/bin/cursor-agent' : null,
      ),
    ).toBe('cursor-agent')
    expect(resolveCursorAgentBinary(() => null)).toBeNull()
  })

  it('formats Orb instructions as a delimited user prompt', () => {
    expect(formatCursorPrompt('system rules', 'do the thing')).toBe(
      'system rules\n\n---\n\nUser request:\ndo the thing',
    )
  })
})

describe('Cursor stream mapper', () => {
  beforeEach(() => resetFrameIds())

  it('maps session ids, partial text, final snapshots, and result completion without duplicates', () => {
    const mapper = createCursorStreamMapper()
    const frames = [
      ...mapper.handleLine(
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          session_id: 'session-1',
        }),
      ).frames,
      ...mapper.handleLine(
        JSON.stringify({
          type: 'thinking',
          subtype: 'delta',
          text: 'private scratch',
          session_id: 'session-1',
        }),
      ).frames,
      ...mapper.handleLine(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hello' }] },
          session_id: 'session-1',
          timestamp_ms: 1,
        }),
      ).frames,
      ...mapper.handleLine(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: ' world' }] },
          session_id: 'session-1',
          timestamp_ms: 2,
        }),
      ).frames,
      ...mapper.handleLine(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hello world' }] },
          session_id: 'session-1',
        }),
      ).frames,
      ...mapper.handleLine(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'hello world',
          session_id: 'session-1',
        }),
      ).frames,
    ]

    expect(frames.map((frame) => frame.kind)).toEqual([
      'agent-session',
      'agent-text-delta',
      'agent-text-delta',
      'agent-text-complete',
    ])
    expect(frames.filter((frame) => frame.kind === 'agent-text-delta')).toEqual([
      expect.objectContaining({ delta: 'hello', accumulatedText: 'hello' }),
      expect.objectContaining({ delta: ' world', accumulatedText: 'hello world' }),
    ])
    expect(frames.at(-1)).toEqual(expect.objectContaining({ text: 'hello world' }))
  })

  it('maps Cursor tool calls to Orb tool frames', () => {
    const mapper = createCursorStreamMapper()
    const start = mapper.handleLine(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        call_id: 'tool-1',
        tool_call: {
          editToolCall: {
            args: { path: '/tmp/file.txt', streamContent: 'ok' },
          },
        },
      }),
    )
    const done = mapper.handleLine(
      JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        call_id: 'tool-1',
        tool_call: {
          editToolCall: {
            args: { path: '/tmp/file.txt', streamContent: 'ok' },
            result: {
              success: {
                message: 'Wrote contents to /tmp/file.txt',
              },
            },
          },
        },
      }),
    )

    expect([...start.frames, ...done.frames]).toEqual([
      expect.objectContaining({
        kind: 'tool-call-start',
        toolCall: expect.objectContaining({
          id: 'tool-1',
          name: 'edit',
          input: { path: '/tmp/file.txt', streamContent: 'ok' },
        }),
      }),
      expect.objectContaining({
        kind: 'tool-call-result',
        toolId: 'tool-1',
        status: 'complete',
        result: 'Wrote contents to /tmp/file.txt',
      }),
    ])
  })

  it('surfaces invalid JSON and failed result events', () => {
    const mapper = createCursorStreamMapper()

    expect(mapper.handleLine('not json').error?.message).toContain('invalid JSON')
    expect(
      mapper.handleLine(
        JSON.stringify({
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: 'Cursor auth failed',
        }),
      ).error?.message,
    ).toBe('Cursor auth failed')
  })
})
