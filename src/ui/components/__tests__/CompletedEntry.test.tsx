import { describe, expect, it } from 'bun:test'
import { render } from 'ink-testing-library'

import { fixtures, normalizeFrame } from '../../__tests__/test-utils'
import { CompletedEntry } from '../CompletedEntry'

describe('CompletedEntry', () => {
  describe('basic rendering', () => {
    it('renders simple entry without tools', () => {
      const entry = fixtures.historyEntry.simple()
      const { lastFrame } = render(<CompletedEntry entry={entry} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('renders entry with error', () => {
      const entry = fixtures.historyEntry.withError()
      const { lastFrame } = render(<CompletedEntry entry={entry} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })
  })

  describe('tool calls', () => {
    it('renders entry with single tool call', () => {
      const entry = fixtures.historyEntry.withTools()
      const { lastFrame } = render(<CompletedEntry entry={entry} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('renders entry with multiple tool calls', () => {
      const entry = fixtures.historyEntry.multiTool()
      const { lastFrame } = render(<CompletedEntry entry={entry} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('renders entry with running tool', () => {
      const entry = fixtures.historyEntry.simple({
        id: 'entry-running',
        toolCalls: [fixtures.toolCall.running()],
      })
      const { lastFrame } = render(<CompletedEntry entry={entry} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })

    it('renders entry with errored tool', () => {
      const entry = fixtures.historyEntry.simple({
        id: 'entry-tool-error',
        toolCalls: [fixtures.toolCall.error()],
      })
      const { lastFrame } = render(<CompletedEntry entry={entry} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })
  })

  describe('content', () => {
    it('displays question text', () => {
      const entry = fixtures.historyEntry.simple({ question: 'What is TypeScript?' })
      const { lastFrame } = render(<CompletedEntry entry={entry} />)

      expect(normalizeFrame(lastFrame())).toContain('What is TypeScript?')
    })

    it('displays answer text', () => {
      const entry = fixtures.historyEntry.simple({
        answer: 'TypeScript is a typed superset of JavaScript.',
      })
      const { lastFrame } = render(<CompletedEntry entry={entry} />)

      expect(normalizeFrame(lastFrame())).toContain('TypeScript is a typed superset of JavaScript.')
    })

    it('displays multiline content', () => {
      const entry = fixtures.historyEntry.simple({
        question: 'Explain briefly',
        answer: 'Line one.\nLine two.\nLine three.',
      })
      const { lastFrame } = render(<CompletedEntry entry={entry} />)
      expect(normalizeFrame(lastFrame())).toMatchSnapshot()
    })
  })
})
