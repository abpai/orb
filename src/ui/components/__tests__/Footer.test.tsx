import { describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame } from '../../__tests__/test-utils'

mock.module('../../hooks/useAnimationFrame', () => ({
  useAnimationFrame: () => 0,
}))

mock.module('../../hooks/useTerminalSize', () => ({
  useTerminalSize: () => ({ columns: 100, rows: 40 }),
}))

import { Footer } from '../Footer'

describe('Footer', () => {
  const defaultProps = {
    state: 'idle' as const,
    onSubmit: () => {},
    model: 'claude-haiku-4-5-20251001',
    provider: 'anthropic' as const,
    canCycleModel: true,
    canTogglePause: false,
    canRepeat: false,
    isPaused: false,
  }

  it('renders micro orb and input prompt', () => {
    const { lastFrame } = render(<Footer {...defaultProps} />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('●')
    expect(frame).toContain('❯')
  })

  it('shows model label', () => {
    const { lastFrame } = render(<Footer {...defaultProps} />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('[Haiku]')
  })

  it('shows keyboard hints at full width', () => {
    const { lastFrame } = render(<Footer {...defaultProps} />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('^O detail')
    expect(frame).toContain('^C')
  })

  it('shows model cycle hint when canCycleModel is true', () => {
    const { lastFrame } = render(<Footer {...defaultProps} canCycleModel={true} />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('⇧Tab model')
  })

  it('hides model cycle hint when canCycleModel is false', () => {
    const { lastFrame } = render(<Footer {...defaultProps} canCycleModel={false} />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).not.toContain('⇧Tab model')
  })

  it('shows raw model name for openai provider', () => {
    const { lastFrame } = render(
      <Footer {...defaultProps} provider="openai" model="gpt-5.4" canCycleModel={false} />,
    )
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('[gpt-5.4]')
  })

  it('shows pause and repeat hints when playback controls are available', () => {
    const { lastFrame } = render(<Footer {...defaultProps} canTogglePause canRepeat />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('^P pause')
    expect(frame).toContain('^R repeat')
  })

  it('shows resume hint while playback is paused', () => {
    const { lastFrame } = render(<Footer {...defaultProps} canTogglePause isPaused />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('^P resume')
  })
})
