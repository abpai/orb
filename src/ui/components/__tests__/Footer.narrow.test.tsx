import { describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame } from '../../__tests__/test-utils'

mock.module('../../hooks/useAnimationFrame', () => ({
  useAnimationFrame: () => 0,
}))

mock.module('../../hooks/useTerminalSize', () => ({
  useTerminalSize: () => ({ columns: 50, rows: 24 }),
}))

import { Footer } from '../Footer'

describe('Footer (narrow terminal < 60 cols)', () => {
  const defaultProps = {
    state: 'idle' as const,
    onSubmit: () => {},
    model: 'claude-haiku-4-5-20251001',
    provider: 'anthropic' as const,
    canCycleModel: true,
  }

  it('always shows ^C hint', () => {
    const { lastFrame } = render(<Footer {...defaultProps} />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('^C')
  })

  it('hides model badge', () => {
    const { lastFrame } = render(<Footer {...defaultProps} />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).not.toContain('[Haiku]')
  })

  it('hides ^O detail and ⇧Tab hints', () => {
    const { lastFrame } = render(<Footer {...defaultProps} />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).not.toContain('^O detail')
    expect(frame).not.toContain('⇧Tab model')
  })

  it('keeps the orb and prompt on the same line', () => {
    const { lastFrame } = render(<Footer {...defaultProps} state="processing" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('⣾ ❯')
  })
})
