/**
 * Test utilities for Ink component testing with ink-testing-library.
 *
 * Provides fixtures plus snapshot normalization helpers.
 */

import type { HistoryEntry, ToolCall } from '../../types'

/**
 * Normalize Ink output for snapshots across terminal environments.
 * Strips ANSI codes, carriage returns, trailing newlines, and trailing whitespace per line.
 */
export function normalizeFrame(frame: string | undefined): string {
  if (!frame) return ''
  const esc = String.fromCharCode(27)
  const ansiPattern = new RegExp(`${esc}\\[[0-9;:?]*[A-Za-z]`, 'g')
  return frame
    .replace(/\r/g, '')
    .replace(ansiPattern, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n+$/g, '')
}

// ─────────────────────────────────────────────────
// Test Fixtures
// ─────────────────────────────────────────────────

export const fixtures = {
  toolCall: {
    read: (overrides?: Partial<ToolCall>): ToolCall => ({
      id: 'tool-1',
      index: 0,
      name: 'Read',
      input: { file_path: '/src/index.ts' },
      status: 'complete',
      result: 'File contents...',
      ...overrides,
    }),

    bash: (overrides?: Partial<ToolCall>): ToolCall => ({
      id: 'tool-2',
      index: 1,
      name: 'Bash',
      input: { command: 'ls -la' },
      status: 'complete',
      result: 'total 8\ndrwxr-xr-x...',
      ...overrides,
    }),

    running: (overrides?: Partial<ToolCall>): ToolCall => ({
      id: 'tool-3',
      index: 2,
      name: 'Grep',
      input: { pattern: 'TODO' },
      status: 'running',
      ...overrides,
    }),

    error: (overrides?: Partial<ToolCall>): ToolCall => ({
      id: 'tool-4',
      index: 3,
      name: 'Write',
      input: { file_path: '/readonly.txt' },
      status: 'error',
      result: 'Permission denied',
      ...overrides,
    }),
  },

  historyEntry: {
    simple: (overrides?: Partial<HistoryEntry>): HistoryEntry => ({
      id: 'entry-1',
      question: 'What is this project?',
      toolCalls: [],
      answer: 'This is a voice-driven code explorer.',
      ...overrides,
    }),

    withTools: (overrides?: Partial<HistoryEntry>): HistoryEntry => ({
      id: 'entry-2',
      question: 'Show me the main file',
      toolCalls: [fixtures.toolCall.read()],
      answer: 'Here is the main entry point.',
      ...overrides,
    }),

    withError: (overrides?: Partial<HistoryEntry>): HistoryEntry => ({
      id: 'entry-3',
      question: 'Do something risky',
      toolCalls: [],
      answer: '',
      error: 'An unexpected error occurred',
      ...overrides,
    }),

    multiTool: (overrides?: Partial<HistoryEntry>): HistoryEntry => ({
      id: 'entry-4',
      question: 'Find and fix the bug',
      toolCalls: [
        fixtures.toolCall.read(),
        fixtures.toolCall.bash(),
        fixtures.toolCall.read({ id: 'tool-5', index: 4 }),
      ],
      answer: 'I found and fixed the issue.',
      ...overrides,
    }),
  },
}
