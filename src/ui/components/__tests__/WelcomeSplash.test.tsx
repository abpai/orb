import { describe, expect, it, mock } from 'bun:test'
import React from 'react'
import { render } from 'ink-testing-library'

// Mock animation hook before importing components
// Using a static frame ensures deterministic snapshots
mock.module('../../hooks/useAnimationFrame', () => ({
  useAnimationFrame: () => 0,
}))

// Import after mocking
import { WelcomeSplash } from '../WelcomeSplash'

describe('WelcomeSplash', () => {
  describe('animation modes', () => {
    it('renders idle mode (default)', () => {
      const { lastFrame } = render(<WelcomeSplash />)
      expect(lastFrame()).toMatchSnapshot()
    })

    it('renders idle mode explicitly', () => {
      const { lastFrame } = render(<WelcomeSplash animationMode="idle" />)
      expect(lastFrame()).toMatchSnapshot()
    })

    it('renders processing mode', () => {
      const { lastFrame } = render(<WelcomeSplash animationMode="processing" />)
      expect(lastFrame()).toMatchSnapshot()
    })

    it('renders speaking mode', () => {
      const { lastFrame } = render(<WelcomeSplash animationMode="speaking" />)
      expect(lastFrame()).toMatchSnapshot()
    })
  })

  describe('layout', () => {
    it('displays welcome text', () => {
      const { lastFrame } = render(<WelcomeSplash />)
      const frame = lastFrame()!

      expect(frame).toContain('talk to claude')
      expect(frame).toContain('say anything')
    })
  })
})
