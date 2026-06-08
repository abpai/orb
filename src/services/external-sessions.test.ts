import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  claudeProjectDir,
  encodeClaudeProjectDir,
  listAllSessions,
  listClaudeSessions,
  listCodexSessions,
  lookupExternalSessionMeta,
} from './external-sessions'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orb-external-'))
  tempDirs.push(dir)
  return dir
}

/** Seed a Claude Code project dir; returns its absolute path. */
async function seedClaudeDir(home: string, projectPath: string): Promise<string> {
  const dir = claudeProjectDir(projectPath, home)
  await mkdir(dir, { recursive: true })
  return dir
}

async function writeJsonl(filePath: string, records: unknown[]): Promise<void> {
  await writeFile(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

const PROJECT = '/Users/test/Projects/demo'

describe('encodeClaudeProjectDir', () => {
  it('replaces every slash and dot with a dash', () => {
    expect(encodeClaudeProjectDir('/Users/x/Projects/orb')).toBe('-Users-x-Projects-orb')
    expect(encodeClaudeProjectDir('/Users/x/.codex/y')).toBe('-Users-x--codex-y')
  })

  it('resolves relative paths before encoding', () => {
    expect(encodeClaudeProjectDir('.')).toBe(encodeClaudeProjectDir(resolve('.')))
  })
})

describe('listClaudeSessions', () => {
  it('returns [] when the project has no Claude dir', async () => {
    const home = await tempHome()
    expect(await listClaudeSessions(PROJECT, home)).toEqual([])
  })

  it('reads rows from the .session_cache.json index and excludes subagents', async () => {
    const home = await tempHome()
    const dir = await seedClaudeDir(home, PROJECT)
    const sessFile = join(dir, 'aaaaaaaa.jsonl')
    await writeFile(sessFile, '')
    await mkdir(join(dir, 'aaaaaaaa', 'subagents'), { recursive: true })
    await writeFile(join(dir, 'aaaaaaaa', 'subagents', 'agent-1.jsonl'), '')
    await writeFile(
      join(dir, '.session_cache.json'),
      JSON.stringify({
        entries: {
          [sessFile]: {
            modified_time: 1_700_000_000,
            first_user_content: 'fix the bug',
            session: {
              actual_session_id: 'aaaaaaaa',
              message_count: 12,
              last_message_time: '2026-06-01T00:00:00.000Z',
            },
          },
          // A subagent entry must be ignored (nested under the session dir).
          [join(dir, 'aaaaaaaa', 'subagents', 'agent-1.jsonl')]: {
            session: { actual_session_id: 'agent-1', message_count: 3 },
          },
        },
      }),
    )

    const rows = await listClaudeSessions(PROJECT, home)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'aaaaaaaa',
      source: 'claude',
      llmProvider: 'anthropic',
      turnCount: 12,
      preview: 'fix the bug',
      lastModified: '2026-06-01T00:00:00.000Z',
    })
  })

  it('falls back to scanning a transcript missing from the index', async () => {
    const home = await tempHome()
    const dir = await seedClaudeDir(home, PROJECT)
    await writeJsonl(join(dir, 'bbbbbbbb.jsonl'), [
      { type: 'progress' },
      { type: 'user', sessionId: 'bbbbbbbb', message: { content: 'string content here' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
      { type: 'user', message: { content: [{ type: 'text', text: 'second turn' }] } },
    ])

    const rows = await listClaudeSessions(PROJECT, home)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'bbbbbbbb',
      source: 'claude',
      turnCount: 2,
      preview: 'string content here',
    })
  })

  it('skips index entries whose transcript file is gone, and malformed entries', async () => {
    const home = await tempHome()
    const dir = await seedClaudeDir(home, PROJECT)
    await writeFile(
      join(dir, '.session_cache.json'),
      JSON.stringify({
        entries: {
          [join(dir, 'gone.jsonl')]: { session: { actual_session_id: 'gone', message_count: 5 } },
          [join(dir, 'bad.jsonl')]: null,
          [join(dir, 'str.jsonl')]: 'garbage',
        },
      }),
    )
    expect(await listClaudeSessions(PROJECT, home)).toEqual([])
  })

  it('does not throw on hostile field types', async () => {
    const home = await tempHome()
    const dir = await seedClaudeDir(home, PROJECT)
    const file = join(dir, 'cccccccc.jsonl')
    await writeFile(file, '')
    await writeFile(
      join(dir, '.session_cache.json'),
      JSON.stringify({
        entries: {
          [file]: {
            modified_time: 1e20, // out of Date range
            first_user_content: { not: 'a string' },
            session: { actual_session_id: 'cccccccc', message_count: 'NaN' },
          },
        },
      }),
    )
    const rows = await listClaudeSessions(PROJECT, home)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.turnCount).toBe(0)
    expect(rows[0]?.preview).toBe('')
    // Out-of-range modified_time falls back to the epoch instead of throwing.
    expect(rows[0]?.lastModified).toBe(new Date(0).toISOString())
  })
})

describe('listCodexSessions', () => {
  async function seedRollout(
    home: string,
    ymd: [string, string, string],
    uuid: string,
    meta: Record<string, unknown>,
    userMessages: string[] = [],
  ): Promise<void> {
    const dir = join(home, '.codex', 'sessions', ...ymd)
    await mkdir(dir, { recursive: true })
    const file = join(dir, `rollout-${ymd.join('-')}T10-00-00-${uuid}.jsonl`)
    await writeJsonl(file, [
      { type: 'session_meta', payload: { id: uuid, ...meta } },
      ...userMessages.map((m) => ({
        type: 'event_msg',
        payload: { type: 'user_message', message: m },
      })),
    ])
  }

  it('returns only rollouts whose cwd matches the project', async () => {
    const home = await tempHome()
    const today = new Date().toISOString().slice(0, 10).split('-') as [string, string, string]
    await seedRollout(home, today, 'match01', { cwd: PROJECT, timestamp: '2026-06-08T10:00:00Z' }, [
      'do the thing',
    ])
    await seedRollout(home, today, 'other1', { cwd: '/somewhere/else', timestamp: 'x' }, ['nope'])

    const { rows, capped } = await listCodexSessions(PROJECT, home)
    expect(capped).toBe(false)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'match01',
      source: 'codex',
      llmProvider: 'openai',
      turnCount: 1,
      preview: 'do the thing',
    })
  })

  it('reports capped=true when the file budget is exhausted', async () => {
    const home = await tempHome()
    const today = new Date().toISOString().slice(0, 10).split('-') as [string, string, string]
    await seedRollout(home, today, 'a1', { cwd: PROJECT, timestamp: 't' }, ['one'])
    await seedRollout(home, today, 'a2', { cwd: '/elsewhere', timestamp: 't' }, ['two'])

    const { capped } = await listCodexSessions(PROJECT, home, { maxFiles: 1 })
    expect(capped).toBe(true)
  })

  it('does not throw on a malformed session_meta (cwd not a string)', async () => {
    const home = await tempHome()
    const today = new Date().toISOString().slice(0, 10).split('-') as [string, string, string]
    await seedRollout(home, today, 'bad1', { cwd: {}, timestamp: 't' })
    const { rows } = await listCodexSessions(PROJECT, home)
    expect(rows).toEqual([])
  })
})

describe('listAllSessions', () => {
  it('merges Claude and Codex sources newest-first', async () => {
    const home = await tempHome()

    // Claude row dated 2026-06-07 (older).
    const dir = await seedClaudeDir(home, PROJECT)
    const claudeFile = join(dir, 'dddddddd.jsonl')
    await writeFile(claudeFile, '')
    await writeFile(
      join(dir, '.session_cache.json'),
      JSON.stringify({
        entries: {
          [claudeFile]: {
            first_user_content: 'claude one',
            session: {
              actual_session_id: 'dddddddd',
              message_count: 4,
              last_message_time: '2026-06-07T00:00:00.000Z',
            },
          },
        },
      }),
    )

    // Codex rollout under today's date dir (so it's scanned) but stamped newer
    // than the Claude row, so it must sort first.
    const today = new Date().toISOString().slice(0, 10).split('-') as [string, string, string]
    const codexDir = join(home, '.codex', 'sessions', ...today)
    await mkdir(codexDir, { recursive: true })
    await writeJsonl(join(codexDir, `rollout-${today.join('-')}T10-00-00-codexnew.jsonl`), [
      {
        type: 'session_meta',
        payload: { id: 'codexnew', cwd: PROJECT, timestamp: '2026-06-09T00:00:00.000Z' },
      },
      { type: 'event_msg', payload: { type: 'user_message', message: 'codex one' } },
    ])

    const { sessions } = await listAllSessions(PROJECT, home)
    expect(sessions.map((s) => [s.source, s.id])).toEqual([
      ['codex', 'codexnew'],
      ['claude', 'dddddddd'],
    ])
  })
})

describe('lookupExternalSessionMeta', () => {
  it('returns the index count + preview for a Claude session', async () => {
    const home = await tempHome()
    const dir = await seedClaudeDir(home, PROJECT)
    const file = join(dir, 'eeeeeeee.jsonl')
    await writeFile(file, '')
    await writeFile(
      join(dir, '.session_cache.json'),
      JSON.stringify({
        entries: {
          [file]: {
            first_user_content: 'remember me',
            session: { actual_session_id: 'eeeeeeee', message_count: 42 },
          },
        },
      }),
    )

    const meta = await lookupExternalSessionMeta(
      { provider: 'anthropic', sessionId: 'eeeeeeee' },
      PROJECT,
      home,
    )
    expect(meta).toMatchObject({ messageCount: 42, preview: 'remember me' })
  })

  it('returns null for an unknown Claude session', async () => {
    const home = await tempHome()
    await seedClaudeDir(home, PROJECT)
    const meta = await lookupExternalSessionMeta(
      { provider: 'anthropic', sessionId: 'missing' },
      PROJECT,
      home,
    )
    expect(meta).toBeNull()
  })

  it('finds a Codex thread by id and counts its user messages', async () => {
    const home = await tempHome()
    const today = new Date().toISOString().slice(0, 10).split('-') as [string, string, string]
    const dir = join(home, '.codex', 'sessions', ...today)
    await mkdir(dir, { recursive: true })
    await writeJsonl(join(dir, `rollout-${today.join('-')}T10-00-00-thread99.jsonl`), [
      { type: 'session_meta', payload: { id: 'thread99', cwd: PROJECT, timestamp: 't' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'first' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'second' } },
    ])

    const meta = await lookupExternalSessionMeta(
      { provider: 'openai', threadId: 'thread99' },
      PROJECT,
      home,
    )
    expect(meta).toMatchObject({ messageCount: 2, preview: 'first' })
  })
})
