import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame } from '../../__tests__/test-utils'

const animationOptions: Array<{ active?: boolean; fps?: number }> = []

mock.module('../../hooks/useAnimationFrame', () => ({
  useAnimationFrame: (options: { active?: boolean; fps?: number }) => {
    animationOptions.push(options)
    return 0
  },
}))

import { MicroOrb } from '../MicroOrb'

describe('MicroOrb', () => {
  beforeEach(() => {
    animationOptions.length = 0
  })

  it('renders green dot when idle', () => {
    const { lastFrame } = render(<MicroOrb state="idle" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('●')
    expect(animationOptions.at(-1)?.active).toBe(false)
  })

  it('renders braille spinner when processing', () => {
    const { lastFrame } = render(<MicroOrb state="processing" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('⣾')
    expect(animationOptions.at(-1)?.active).toBe(true)
  })

  it('renders a static dot when only speaking', () => {
    const { lastFrame } = render(<MicroOrb state="speaking" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('●')
    expect(animationOptions.at(-1)?.active).toBe(false)
  })

  it('renders braille spinner when processing_speaking', () => {
    const { lastFrame } = render(<MicroOrb state="processing_speaking" />)
    const frame = normalizeFrame(lastFrame())
    expect(frame).toContain('⣾')
    expect(animationOptions.at(-1)?.active).toBe(true)
  })
})
