import { describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame } from '../../__tests__/test-utils'

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
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('renders idle mode explicitly', () => {
      const { lastFrame } = render(<WelcomeSplash animationMode="idle" />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('renders processing mode', () => {
      const { lastFrame } = render(<WelcomeSplash animationMode="processing" />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('renders speaking mode', () => {
      const { lastFrame } = render(<WelcomeSplash animationMode="speaking" />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })
  })

  describe('layout', () => {
    it('displays welcome text with default label', () => {
      const { lastFrame } = render(<WelcomeSplash />)
      const frame = normalizeFrame(lastFrame())

      expect(frame).toContain('talk to claude')
      expect(frame).toContain('press enter to continue')
    })

    it('displays custom assistant label', () => {
      const { lastFrame } = render(<WelcomeSplash assistantLabel="openai" />)
      const frame = normalizeFrame(lastFrame())

      expect(frame).toContain('talk to openai')
      expect(frame).not.toContain('talk to claude')
    })
  })

  describe('project name header', () => {
    it('displays spaced project name above the orb', () => {
      const { lastFrame } = render(<WelcomeSplash projectName="orb" />)
      const frame = normalizeFrame(lastFrame())

      expect(frame).toContain('o r b')
    })

    it('omits project name when not provided', () => {
      const { lastFrame } = render(<WelcomeSplash />)
      const frame = normalizeFrame(lastFrame())

      expect(frame).not.toContain('o r b')
    })
  })

  describe('config summary', () => {
    it('displays model, voice, and speed when TTS enabled', () => {
      const { lastFrame } = render(
        <WelcomeSplash modelLabel="Haiku" ttsVoice="alba" ttsSpeed={1.5} ttsEnabled />,
      )
      const frame = normalizeFrame(lastFrame())

      expect(frame).toContain('haiku · alba · x1.5')
    })

    it('omits TTS info when TTS disabled', () => {
      const { lastFrame } = render(
        <WelcomeSplash modelLabel="Haiku" ttsVoice="alba" ttsSpeed={1.5} ttsEnabled={false} />,
      )
      const frame = normalizeFrame(lastFrame())

      expect(frame).toContain('haiku')
      expect(frame).not.toContain('alba')
      expect(frame).not.toContain('x1.5')
    })

    it('omits config summary when no props provided', () => {
      const { lastFrame } = render(<WelcomeSplash />)
      const frame = normalizeFrame(lastFrame())

      // Should not contain the separator pattern used in config summary
      expect(frame).not.toContain('·')
    })
  })
})
