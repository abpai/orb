import { describe, expect, it } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame } from '../../__tests__/test-utils'
import { SessionPicker, formatRelativeTime } from '../SessionPicker'
import type { SessionSummary } from '../../../services/session'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'id-a',
    projectPath: '/projects/orb',
    projectName: 'orb',
    llmProvider: 'anthropic',
    llmModel: 'claude-haiku-4-5-20251001',
    lastModified: new Date().toISOString(),
    turnCount: 3,
    preview: 'how do I list sessions',
    ...overrides,
  }
}

describe('SessionPicker', () => {
  it('renders the first message as the title with folder path and turn count', () => {
    const app = render(
      <SessionPicker sessions={[summary()]} onSelect={() => {}} onCancel={() => {}} />,
    )
    const frame = normalizeFrame(app.lastFrame())
    expect(frame).toContain('how do I list sessions')
    expect(frame).toContain('/projects/orb')
    expect(frame).toContain('3 turns')
    app.unmount()
  })

  it('pluralizes a single turn', () => {
    const app = render(
      <SessionPicker
        sessions={[summary({ turnCount: 1 })]}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    )
    const frame = normalizeFrame(app.lastFrame())
    expect(frame).toContain('1 turn')
    expect(frame).not.toContain('1 turns')
    app.unmount()
  })

  it('windows a long list and shows how many rows are hidden', () => {
    const sessions = Array.from({ length: 40 }, (_, i) =>
      summary({ id: `id-${i}`, preview: `chat number ${i}` }),
    )
    const app = render(
      <SessionPicker sessions={sessions} onSelect={() => {}} onCancel={() => {}} />,
    )
    const frame = normalizeFrame(app.lastFrame())
    // First rows are visible; far-down rows are not, and a "more" indicator hints at them.
    expect(frame).toContain('chat number 0')
    expect(frame).not.toContain('chat number 39')
    expect(frame).toContain('more')
    app.unmount()
  })

  it('labels Gemini sessions as Gemini', () => {
    const app = render(
      <SessionPicker
        sessions={[summary({ llmProvider: 'gemini' })]}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    )
    const frame = normalizeFrame(app.lastFrame())
    expect(frame).toContain('gemini')
    expect(frame).not.toContain('openai')
    app.unmount()
  })

  it('resumes the highlighted session on enter', async () => {
    const selected: SessionSummary[] = []
    const sessions = [
      summary({ id: 'first', projectName: 'first-proj', preview: 'first chat' }),
      summary({ id: 'second', projectName: 'second-proj', preview: 'second chat' }),
    ]
    const app = render(
      <SessionPicker sessions={sessions} onSelect={(s) => selected.push(s)} onCancel={() => {}} />,
    )

    app.stdin.write('[B') // arrow down → second row
    await flush()
    app.stdin.write('\r') // enter
    await flush()

    expect(selected.map((s) => s.id)).toEqual(['second'])
    app.unmount()
  })

  it('filters live as the user types', async () => {
    const sessions = [
      summary({ id: 'alpha', projectName: 'alpha-proj', preview: 'alpha chat' }),
      summary({ id: 'beta', projectName: 'beta-proj', preview: 'beta chat' }),
    ]
    const app = render(
      <SessionPicker sessions={sessions} onSelect={() => {}} onCancel={() => {}} />,
    )

    app.stdin.write('beta')
    await flush()

    const frame = normalizeFrame(app.lastFrame())
    expect(frame).toContain('beta chat')
    expect(frame).not.toContain('alpha chat')
    app.unmount()
  })

  it('cancels on escape', async () => {
    let cancelled = false
    const app = render(
      <SessionPicker
        sessions={[summary()]}
        onSelect={() => {}}
        onCancel={() => (cancelled = true)}
      />,
    )

    app.stdin.write('') // escape
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(cancelled).toBe(true)
    app.unmount()
  })
})

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-06-06T12:00:00.000Z')

  it('formats recent and older timestamps', () => {
    expect(formatRelativeTime('2026-06-06T11:59:50.000Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-06-06T11:40:00.000Z', now)).toBe('20 min ago')
    expect(formatRelativeTime('2026-06-06T09:00:00.000Z', now)).toBe('3 hr ago')
    expect(formatRelativeTime('2026-06-05T12:00:00.000Z', now)).toBe('yesterday')
    expect(formatRelativeTime('2026-05-08T12:00:00.000Z', now)).toBe('29 days ago')
  })
})
