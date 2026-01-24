import { describe, expect, it, mock } from 'bun:test'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'

// Mock the Spinner component since it uses animation timers
// Text wrapper required by Ink's rendering model
mock.module('@inkjs/ui', () => ({
  Spinner: ({ label }: { label?: string }) => <Text>[spinner]{label ? ` ${label}` : ''}</Text>,
}))

// Import after mocking
import { ResonanceBar } from '../ResonanceBar'

describe('ResonanceBar', () => {
  describe('status indicator', () => {
    it('renders idle state as ready', () => {
      const { lastFrame } = render(<ResonanceBar status="idle" />)
      expect(lastFrame()).toMatchSnapshot()
    })

    it('renders processing state with spinner', () => {
      const { lastFrame } = render(<ResonanceBar status="processing" />)
      expect(lastFrame()).toMatchSnapshot()
    })

    it('renders speaking state', () => {
      const { lastFrame } = render(<ResonanceBar status="speaking" />)
      expect(lastFrame()).toMatchSnapshot()
    })

    it('renders processing_speaking state with spinner', () => {
      const { lastFrame } = render(<ResonanceBar status="processing_speaking" />)
      expect(lastFrame()).toMatchSnapshot()
    })
  })

  describe('transcript hint', () => {
    it('shows transcript hint when idle with history', () => {
      const { lastFrame } = render(<ResonanceBar status="idle" hasHistory={true} />)
      expect(lastFrame()).toMatchSnapshot()
    })

    it('hides transcript hint when idle without history', () => {
      const { lastFrame } = render(<ResonanceBar status="idle" hasHistory={false} />)
      expect(lastFrame()).toMatchSnapshot()
    })

    it('hides transcript hint when processing with history', () => {
      const { lastFrame } = render(<ResonanceBar status="processing" hasHistory={true} />)
      expect(lastFrame()).toMatchSnapshot()
    })
  })
})
