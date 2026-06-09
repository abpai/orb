import { describe, expect, it } from 'bun:test'

import type { SessionSummary } from './services/session'
import {
  formatSessionsHelp,
  formatSessionList,
  parseSessionsArgs,
  runSessionsCommand,
} from './sessions-cli'

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

  it('prints resume commands with runtime flags preserved', () => {
    const output = formatSessionList(
      [summary({ id: 'thread-1', source: 'codex', llmProvider: 'openai' })],
      { resumeExtraArgs: ['--model=gpt-5.5', '--provider=openai'] },
    )

    expect(output).toContain(
      'resume: orb /Users/andy/Projects/orb --codex-thread thread-1 --model=gpt-5.5 --provider=openai',
    )
  })
})

describe('parseSessionsArgs', () => {
  it('keeps runtime flags for the eventual resumed orb process', () => {
    expect(parseSessionsArgs(['--all', '--model=gpt-5.5', '--provider', 'openai'])).toEqual({
      includeExternal: true,
      resumeExtraArgs: ['--model=gpt-5.5', '--provider', 'openai'],
    })
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
