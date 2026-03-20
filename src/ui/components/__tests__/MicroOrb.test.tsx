import { describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame } from '../../__tests__/test-utils'

mock.module('../../hooks/useAnimationFrame', () => ({
  useAnimationFrame: () => 0,
}))

import { MicroOrb } from '../MicroOrb'

describe('MicroOrb', () => {
  it('renders green dot when idle', () => {
    const { lastFrame } = render(<MicroOrb state="idle" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('●')
  })

  it('renders braille spinner when processing', () => {
    const { lastFrame } = render(<MicroOrb state="processing" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('⣾')
  })

  it('renders braille spinner when speaking', () => {
    const { lastFrame } = render(<MicroOrb state="speaking" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('⣾')
  })

  it('renders braille spinner when processing_speaking', () => {
    const { lastFrame } = render(<MicroOrb state="processing_speaking" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('⣾')
  })
})
