import { describe, expect, it } from 'bun:test'

import type { SessionSummary } from './services/session'
import { formatSessionsHelp, formatSessionList, runSessionsCommand } from './sessions-cli'

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

    expect(output).toContain('· gemini ·')
    expect(output).not.toContain('· openai ·')
  })

  it('shows the first message as the title and the folder path beneath it', () => {
    const output = formatSessionList([
      summary({ projectPath: '/Users/andy/Projects/orb', preview: 'resume this project' }),
    ])

    expect(output).toContain('resume this project')
    expect(output).toContain('/Users/andy/Projects/orb')
  })
})

describe('runSessionsCommand --help', () => {
  it('documents usage including --all', () => {
    const help = formatSessionsHelp()
    expect(help).toContain('orb sessions')
    expect(help).toContain('--all')
  })

  it('prints usage and returns without opening the picker', async () => {
    const logs: string[] = []
    const original = console.log
    console.log = ((...args: unknown[]) => {
      logs.push(args.join(' '))
    }) as typeof console.log
    try {
      await runSessionsCommand(['--help'])
    } finally {
      console.log = original
    }

    expect(logs.join('\n')).toContain('orb sessions')
    expect(logs.join('\n')).toContain('--all')
  })
})
