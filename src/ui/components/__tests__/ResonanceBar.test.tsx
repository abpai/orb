import { describe, expect, it, mock } from 'bun:test'
import React from 'react'
import { Text } from 'ink'
import { render } from 'ink-testing-library'

import { normalizeFrame } from '../../__tests__/test-utils'

// Mock the Spinner component since it uses animation timers
// Text wrapper required by Ink's rendering model
mock.module('@inkjs/ui', () => ({
  Spinner: ({ label }: { label?: string }) => <Text>[spinner]{label ? ` ${label}` : ''}</Text>,
}))

// Import after mocking
import { ResonanceBar } from '../ResonanceBar'

describe('ResonanceBar', () => {
  const model = 'claude-haiku-4-5-20251001' as const

  describe('status indicator', () => {
    it('renders idle state as ready', () => {
      const { lastFrame } = render(<ResonanceBar status="idle" model={model} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('renders processing state with spinner', () => {
      const { lastFrame } = render(<ResonanceBar status="processing" model={model} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('renders speaking state', () => {
      const { lastFrame } = render(<ResonanceBar status="speaking" model={model} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('renders processing_speaking state with spinner', () => {
      const { lastFrame } = render(<ResonanceBar status="processing_speaking" model={model} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })
  })

  describe('transcript hint', () => {
    it('shows transcript hint when idle with history', () => {
      const { lastFrame } = render(<ResonanceBar status="idle" hasHistory={true} model={model} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('hides transcript hint when idle without history', () => {
      const { lastFrame } = render(<ResonanceBar status="idle" hasHistory={false} model={model} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('hides transcript hint when processing with history', () => {
      const { lastFrame } = render(
        <ResonanceBar status="processing" hasHistory={true} model={model} />,
      )
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })
  })
})
