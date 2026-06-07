import { describe, expect, it } from 'bun:test'

import type { SessionSummary } from './services/session'
import { formatSessionList } from './sessions-cli'

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session-a',
    projectPath: '/Users/andy/Projects/orb',
    projectName: 'orb',
    llmProvider: 'anthropic',
    llmModel: 'claude-haiku-4-5-20251001',
    lastModified: '2026-06-06T12:00:00.000Z',
    turnCount: 2,
    preview: 'resume this project',
    ...overrides,
  }
}

describe('formatSessionList', () => {
  it('prints a shell-safe resume command for paths and ids with spaces', () => {
    const output = formatSessionList([
      summary({
        id: 'session with spaces',
        projectPath: '/Users/andy/Projects/orb demo',
      }),
    ])

    expect(output).toContain(
      "resume: orb '/Users/andy/Projects/orb demo' --resume 'session with spaces'",
    )
  })

  it('labels Gemini sessions as Gemini', () => {
    const output = formatSessionList([summary({ llmProvider: 'gemini' })])

    expect(output).toContain('(gemini ·')
    expect(output).not.toContain('(openai ·')
  })
})
