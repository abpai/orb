import { describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame, fixtures } from '../../__tests__/test-utils'

mock.module('../../hooks/useTerminalSize', () => ({
  useTerminalSize: () => ({ columns: 100, rows: 40 }),
}))

import { ActivityTimeline } from '../ActivityTimeline'

describe('ActivityTimeline', () => {
  it('renders nothing when no tool calls', () => {
    const { lastFrame } = render(<ActivityTimeline toolCalls={[]} detailMode="compact" />)
    expect(lastFrame()).toBe('')
  })

  it('renders each tool call as a row', () => {
    const calls = [fixtures.toolCall.read(), fixtures.toolCall.bash()]
    const { lastFrame } = render(<ActivityTimeline toolCalls={calls} detailMode="compact" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('✓')
    expect(frame).toContain('Read')
    expect(frame).toContain('Bash')
  })

  it('shows spinner icon for running tools', () => {
    const calls = [fixtures.toolCall.running()]
    const { lastFrame } = render(<ActivityTimeline toolCalls={calls} detailMode="compact" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('⠋')
    expect(frame).toContain('Grep')
  })

  it('shows error icon for failed tools', () => {
    const calls = [fixtures.toolCall.error()]
    const { lastFrame } = render(<ActivityTimeline toolCalls={calls} detailMode="compact" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('✗')
    expect(frame).toContain('Write')
  })

  it('hides error details in compact mode', () => {
    const calls = [fixtures.toolCall.error()]
    const { lastFrame } = render(<ActivityTimeline toolCalls={calls} detailMode="compact" isLive />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).not.toContain('Permission denied')
  })

  it('shows error details in expanded mode for live turn', () => {
    const calls = [fixtures.toolCall.error()]
    const { lastFrame } = render(
      <ActivityTimeline toolCalls={calls} detailMode="expanded" isLive />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('Permission denied')
  })

  it('hides error details in expanded mode for non-live turn', () => {
    const calls = [fixtures.toolCall.error()]
    const { lastFrame } = render(
      <ActivityTimeline toolCalls={calls} detailMode="expanded" isLive={false} />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).not.toContain('Permission denied')
  })

  it('shows success result details in expanded mode for live turn', () => {
    const calls = [fixtures.toolCall.read()]
    const { lastFrame } = render(
      <ActivityTimeline toolCalls={calls} detailMode="expanded" isLive />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('File contents...')
  })

  it('hides success result details in compact mode', () => {
    const calls = [fixtures.toolCall.read()]
    const { lastFrame } = render(<ActivityTimeline toolCalls={calls} detailMode="compact" isLive />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).not.toContain('File contents...')
  })

  it('hides details for running tools even in expanded mode', () => {
    const calls = [fixtures.toolCall.running()]
    const { lastFrame } = render(
      <ActivityTimeline toolCalls={calls} detailMode="expanded" isLive />,
    )
    const frame = normalizeFrame(lastFrame())
    // Running tools have no result yet
    expect(frame).not.toContain('↳')
  })
})
