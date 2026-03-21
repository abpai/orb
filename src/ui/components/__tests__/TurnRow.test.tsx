import { describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame, fixtures } from '../../__tests__/test-utils'

mock.module('../../hooks/useTerminalSize', () => ({
  useTerminalSize: () => ({ columns: 100, rows: 40 }),
}))

import { TurnRow } from '../TurnRow'

describe('TurnRow', () => {
  it('renders question with you: prefix', () => {
    const turn = fixtures.historyEntry.simple()
    const { lastFrame } = render(
      <TurnRow turn={turn} detailMode="compact" assistantLabel="claude" />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('you:')
    expect(frame).toContain('What is this project?')
  })

  it('renders answer with assistant label', () => {
    const turn = fixtures.historyEntry.simple()
    const { lastFrame } = render(
      <TurnRow turn={turn} detailMode="compact" assistantLabel="claude" />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('claude:')
    expect(frame).toContain('voice-driven code explorer')
  })

  it('uses custom assistant label', () => {
    const turn = fixtures.historyEntry.simple()
    const { lastFrame } = render(
      <TurnRow turn={turn} detailMode="compact" assistantLabel="openai" />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('openai:')
  })

  it('renders tool calls between question and answer', () => {
    const turn = fixtures.historyEntry.withTools()
    const { lastFrame } = render(
      <TurnRow turn={turn} detailMode="compact" assistantLabel="claude" />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Read')
    expect(frame).toContain('✓')
  })

  it('shows thinking indicator for live turn with no answer', () => {
    const turn = fixtures.historyEntry.simple({ answer: '' })
    const { lastFrame } = render(
      <TurnRow turn={turn} detailMode="compact" isLive assistantLabel="claude" />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('claude:')
    expect(frame).toContain('…')
  })

  it('does not show thinking indicator for non-live turn with no answer', () => {
    const turn = fixtures.historyEntry.simple({ answer: '' })
    const { lastFrame } = render(
      <TurnRow turn={turn} detailMode="compact" assistantLabel="claude" />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).not.toContain('…')
  })

  it('renders error entries', () => {
    const turn = fixtures.historyEntry.withError()
    const { lastFrame } = render(
      <TurnRow turn={turn} detailMode="compact" assistantLabel="claude" />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Error:')
    expect(frame).toContain('unexpected error')
  })
})
