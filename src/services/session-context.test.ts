import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { claudeProjectDir } from './external-sessions/claude'
import { formatSessionContext, loadSessionContext, parseSessionReference } from './session-context'

const cleanupPaths = new Set<string>()
const PROJECT = '/Users/andypai/Projects/investing/garage-band'

afterEach(async () => {
  await Promise.all([...cleanupPaths].map((target) => rm(target, { recursive: true, force: true })))
  cleanupPaths.clear()
})

async function makeHome(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'orb-session-context-'))
  cleanupPaths.add(dir)
  return dir
}

function jsonl(lines: unknown[]): string {
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
}

async function seedClaude(home: string, sessionId: string): Promise<string> {
  const dir = claudeProjectDir(PROJECT, home)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  await writeFile(
    filePath,
    jsonl([
      {
        type: 'user',
        sessionId,
        timestamp: '2026-07-01T10:00:00Z',
        message: { role: 'user', content: [{ type: 'text', text: 'How does the skeleton work?' }] },
      },
      {
        type: 'assistant',
        sessionId,
        timestamp: '2026-07-01T10:00:01Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'It starts from the deletion-heavy baseline.' },
            { type: 'tool_use', name: 'Read', input: { file_path: 'docs/todos/m0.md' } },
          ],
        },
      },
      {
        type: 'user',
        sessionId,
        timestamp: '2026-07-01T10:00:02Z',
        message: { role: 'user', content: [{ type: 'tool_result', content: 'M0 notes' }] },
      },
    ]),
  )
  return filePath
}

async function seedCodex(home: string, threadId: string): Promise<string> {
  const dir = path.join(home, '.codex', 'sessions', '2026', '07', '01')
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `rollout-2026-07-01T10-00-00-${threadId}.jsonl`)
  await writeFile(
    filePath,
    jsonl([
      {
        type: 'session_meta',
        payload: { id: threadId, cwd: PROJECT, timestamp: '2026-07-01T10:00:00Z' },
      },
      {
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: 'What changed in the parser?',
          timestamp: '2026-07-01T10:00:01Z',
        },
      },
      {
        type: 'response_item',
        payload: {
          timestamp: '2026-07-01T10:00:02Z',
          item: {
            type: 'function_call',
            name: 'read_file',
            arguments: '{"path":"src/parser.ts"}',
          },
        },
      },
      {
        type: 'response_item',
        payload: {
          timestamp: '2026-07-01T10:00:03Z',
          item: {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'The parser now normalizes cumulative deltas.' },
            ],
          },
        },
      },
    ]),
  )
  return filePath
}

describe('parseSessionReference', () => {
  it('parses a pasted Claude session block', () => {
    expect(
      parseSessionReference(`claude  Session ID:       claude-123\n  cwd:              ${PROJECT}`),
    ).toEqual({ provider: 'claude', id: 'claude-123', cwd: PROJECT })
  })

  it('parses a pasted Codex thread block', () => {
    expect(parseSessionReference(`codex Thread ID: thread-123\ncwd: ${PROJECT}`)).toEqual({
      provider: 'codex',
      id: 'thread-123',
      cwd: PROJECT,
    })
  })
})

describe('loadSessionContext', () => {
  it('loads and formats recent Claude transcript entries', async () => {
    const home = await makeHome()
    const transcriptPath = await seedClaude(home, 'claude-abc')

    const context = await loadSessionContext(
      { provider: 'claude', id: 'claude-abc', cwd: PROJECT },
      { homeDir: home, tail: 10 },
    )

    expect(context.transcriptPath).toBe(transcriptPath)
    expect(context.entries.map((entry) => entry.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
    ])
    expect(formatSessionContext(context)).toContain('tool use: Read')
  })

  it('can hide tool entries for a tighter learning summary', async () => {
    const home = await makeHome()
    await seedClaude(home, 'claude-abc')

    const context = await loadSessionContext(
      { provider: 'claude', id: 'claude-abc', cwd: PROJECT },
      { homeDir: home, includeTools: false },
    )

    expect(context.entries.map((entry) => entry.role)).toEqual(['user', 'assistant'])
  })

  it('loads recent Codex rollout entries', async () => {
    const home = await makeHome()
    const transcriptPath = await seedCodex(home, 'thread-abc')

    const context = await loadSessionContext(
      { provider: 'codex', id: 'thread-abc', cwd: PROJECT },
      { homeDir: home, tail: 2 },
    )

    expect(context.transcriptPath).toBe(transcriptPath)
    expect(context.entries.map((entry) => entry.role)).toEqual(['tool', 'assistant'])
    expect(formatSessionContext(context)).toContain('The parser now normalizes cumulative deltas.')
  })

  it('runs the session-context script against a fixture', async () => {
    const home = await makeHome()
    await seedCodex(home, 'thread-cli')

    const proc = Bun.spawn(
      [
        process.execPath,
        'src/tools/session-context.ts',
        '--provider',
        'codex',
        '--id',
        'thread-cli',
        '--cwd',
        PROJECT,
        '--home',
        home,
        '--tail',
        '1',
      ],
      { cwd: path.resolve(import.meta.dir, '..', '..') },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout).toContain('Showing: 1 of 3 normalized entries')
    expect(stdout).toContain('The parser now normalizes cumulative deltas.')
  })
})
