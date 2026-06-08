import { describe, expect, it } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame } from '../../__tests__/test-utils'
import { ResumeBanner } from '../ResumeBanner'

describe('ResumeBanner', () => {
  it('shows the source label and a pluralized message count', () => {
    const frame = normalizeFrame(
      render(<ResumeBanner info={{ source: 'claude', messageCount: 189 }} />).lastFrame(),
    )
    expect(frame).toContain('Resumed Claude Code session')
    expect(frame).toContain('189 earlier messages hidden')
    expect(frame).toContain('the model still has full context')
  })

  it('uses the singular form for a single message and labels Codex', () => {
    const frame = normalizeFrame(
      render(<ResumeBanner info={{ source: 'codex', messageCount: 1 }} />).lastFrame(),
    )
    expect(frame).toContain('Resumed Codex session')
    expect(frame).toContain('1 earlier message hidden')
    expect(frame).not.toContain('1 earlier messages')
  })

  it('falls back to a count-free message when the count is unknown', () => {
    const frame = normalizeFrame(render(<ResumeBanner info={{ source: 'claude' }} />).lastFrame())
    expect(frame).toContain('earlier history hidden')
    expect(frame).toContain('the model still remembers it')
  })
})
