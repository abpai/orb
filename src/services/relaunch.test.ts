import { describe, expect, it } from 'bun:test'

import type { SessionSummary } from './session'
import { buildExternalResumeArgs, buildResumeArgs, buildResumeArgsForSession } from './relaunch'

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'id-1',
    projectPath: '/p',
    projectName: 'p',
    llmProvider: 'anthropic',
    llmModel: '',
    lastModified: '',
    turnCount: 0,
    preview: '',
    source: 'orb',
    ...overrides,
  } as SessionSummary
}

describe('buildExternalResumeArgs', () => {
  it('maps each source to the right resume flag', () => {
    expect(buildExternalResumeArgs('/p', 'orb', 'x')).toEqual(['/p', '--resume', 'x'])
    expect(buildExternalResumeArgs('/p', 'claude', 'x')).toEqual(['/p', '--claude-session', 'x'])
    expect(buildExternalResumeArgs('/p', 'codex', 'x')).toEqual(['/p', '--codex-thread', 'x'])
  })
})

describe('buildResumeArgsForSession', () => {
  it('routes orb rows through the orb --resume path', () => {
    expect(buildResumeArgsForSession(summary({ id: 'orb1', source: 'orb' }))).toEqual(
      buildResumeArgs('/p', 'orb1'),
    )
  })

  it('uses the handoff flag for external sources', () => {
    expect(buildResumeArgsForSession(summary({ id: 'sess', source: 'claude' }))).toEqual([
      '/p',
      '--claude-session',
      'sess',
    ])
    expect(buildResumeArgsForSession(summary({ id: 'thr', source: 'codex' }))).toEqual([
      '/p',
      '--codex-thread',
      'thr',
    ])
  })

  it('appends caller-provided runtime flags after the resume target', () => {
    expect(
      buildResumeArgsForSession(summary({ id: 'thr', source: 'codex' }), [
        '--provider=openai',
        '--model=gpt-5.5',
      ]),
    ).toEqual(['/p', '--codex-thread', 'thr', '--provider=openai', '--model=gpt-5.5'])
  })
})
