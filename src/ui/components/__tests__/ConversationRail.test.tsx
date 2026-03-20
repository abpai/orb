import { describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame, fixtures } from '../../__tests__/test-utils'

mock.module('../../hooks/useTerminalSize', () => ({
  useTerminalSize: () => ({ columns: 100, rows: 40 }),
}))

import { ConversationRail } from '../ConversationRail'

describe('ConversationRail', () => {
  it('renders completed turns', () => {
    const turns = [fixtures.historyEntry.simple()]
    const { lastFrame } = render(
      <ConversationRail
        completedTurns={turns}
        liveTurn={null}
        detailMode="compact"
        assistantLabel="claude"
      />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('you:')
    expect(frame).toContain('claude:')
  })

  it('renders live turn when present', () => {
    const liveTurn = fixtures.historyEntry.simple({
      id: 'live-1',
      answer: '',
    })
    const { lastFrame } = render(
      <ConversationRail
        completedTurns={[]}
        liveTurn={liveTurn}
        detailMode="compact"
        assistantLabel="claude"
      />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('you:')
    expect(frame).toContain('thinking...')
  })

  it('renders both completed and live turns', () => {
    const completed = [fixtures.historyEntry.simple()]
    const live = fixtures.historyEntry.simple({
      id: 'live-1',
      question: 'Follow up question',
      answer: 'Working on it...',
    })
    const { lastFrame } = render(
      <ConversationRail
        completedTurns={completed}
        liveTurn={live}
        detailMode="compact"
        assistantLabel="claude"
      />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('What is this project?')
    expect(frame).toContain('Follow up question')
  })

  it('renders empty when no turns', () => {
    const { lastFrame } = render(
      <ConversationRail
        completedTurns={[]}
        liveTurn={null}
        detailMode="compact"
        assistantLabel="claude"
      />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toBe('')
  })
})
