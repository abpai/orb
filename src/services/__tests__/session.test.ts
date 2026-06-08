import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { SavedSession } from '../../types'
import {
  getLegacyPathForTest,
  getSessionFilePath,
  listSessions,
  loadSession,
  loadSessionById,
  saveSession,
} from '../session'

function makeSession(projectPath: string, overrides: Partial<SavedSession> = {}): SavedSession {
  return {
    version: 2,
    id: 'session-a',
    projectPath,
    llmProvider: 'anthropic',
    llmModel: 'claude-haiku-4-5-20251001',
    lastModified: new Date().toISOString(),
    history: [{ id: 'entry-1', question: 'hello', toolCalls: [], answer: 'hi', error: null }],
    ...overrides,
  }
}

/**
 * Write a session file directly, preserving its `lastModified`. saveSession
 * intentionally re-stamps the time, which would make ordering tests flaky.
 */
async function writeSessionFile(session: SavedSession, homeDir: string): Promise<void> {
  const filePath = getSessionFilePath(session.projectPath, session.id, homeDir)
  await mkdir(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, JSON.stringify(session, null, 2))
}

describe('session persistence', () => {
  const cleanupPaths = new Set<string>()

  async function tempHome(): Promise<string> {
    const home = await mkdtemp(path.join(tmpdir(), 'orb-home-'))
    cleanupPaths.add(home)
    return home
  }

  async function tempProject(): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), 'orb-project-'))
    cleanupPaths.add(root)
    const projectPath = path.join(root, 'project')
    await mkdir(projectPath, { recursive: true })
    return projectPath
  }

  afterEach(async () => {
    for (const cleanupPath of cleanupPaths) {
      await rm(cleanupPath, { recursive: true, force: true })
    }
    cleanupPaths.clear()
  })

  it('round-trips a v2 session payload', async () => {
    const home = await tempHome()
    const projectPath = await tempProject()

    const session = makeSession(projectPath, {
      id: 'oai-1',
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      agentSession: { provider: 'openai', threadId: 'resp_123' },
    })

    await saveSession(session, home)
    const loaded = await loadSession(projectPath, home)

    expect(loaded).not.toBeNull()
    expect(loaded?.id).toBe('oai-1')
    expect(loaded?.llmProvider).toBe('openai')
    expect(loaded?.agentSession).toEqual(session.agentSession)
    expect(loaded?.history).toEqual(session.history)
  })

  it('keeps multiple sessions per project and loads the newest', async () => {
    const home = await tempHome()
    const projectPath = await tempProject()

    await writeSessionFile(
      makeSession(projectPath, { id: 'older', lastModified: '2026-01-01T00:00:00.000Z' }),
      home,
    )
    await writeSessionFile(
      makeSession(projectPath, {
        id: 'newer',
        lastModified: '2026-06-01T00:00:00.000Z',
        history: [
          { id: 'e', question: 'newest question', toolCalls: [], answer: 'a', error: null },
        ],
      }),
      home,
    )

    const latest = await loadSession(projectPath, home)
    expect(latest?.id).toBe('newer')

    // Both remain individually addressable by id.
    expect((await loadSessionById(projectPath, 'older', home))?.id).toBe('older')
    expect((await loadSessionById(projectPath, 'newer', home))?.id).toBe('newer')
  })

  it('lists sessions across projects, newest first', async () => {
    const home = await tempHome()
    const projectA = await tempProject()
    const projectB = await tempProject()

    await writeSessionFile(
      makeSession(projectA, {
        id: 'a-old',
        lastModified: '2026-01-01T00:00:00.000Z',
        history: [{ id: 'e', question: 'project A chat', toolCalls: [], answer: 'a', error: null }],
      }),
      home,
    )
    await writeSessionFile(
      makeSession(projectB, {
        id: 'b-new',
        lastModified: '2026-06-01T00:00:00.000Z',
        history: [{ id: 'e', question: 'project B chat', toolCalls: [], answer: 'a', error: null }],
      }),
      home,
    )

    const summaries = await listSessions(home)
    expect(summaries.map((s) => s.id)).toEqual(['b-new', 'a-old'])
    expect(summaries[0]?.preview).toBe('project B chat')
    expect(summaries[0]?.turnCount).toBe(1)
  })

  it('scopes the listing to a single project when a projectPath is given', async () => {
    const home = await tempHome()
    const projectA = await tempProject()
    const projectB = await tempProject()

    await writeSessionFile(
      makeSession(projectA, {
        id: 'a-1',
        history: [{ id: 'e', question: 'project A chat', toolCalls: [], answer: 'a', error: null }],
      }),
      home,
    )
    await writeSessionFile(
      makeSession(projectB, {
        id: 'b-1',
        history: [{ id: 'e', question: 'project B chat', toolCalls: [], answer: 'a', error: null }],
      }),
      home,
    )

    const summaries = await listSessions(home, projectA)
    expect(summaries.map((s) => s.id)).toEqual(['a-1'])
    expect(summaries.every((s) => s.projectPath === path.resolve(projectA))).toBe(true)
  })

  it('migrates a legacy flat v1 session into the per-project directory', async () => {
    const home = await tempHome()
    const projectPath = await tempProject()

    const legacyPath = getLegacyPathForTest(projectPath, home)
    await mkdir(path.dirname(legacyPath), { recursive: true })
    await Bun.write(
      legacyPath,
      JSON.stringify({
        version: 1,
        projectPath,
        sessionId: 'claude-session-123',
        model: 'claude-haiku-4-5-20251001',
        lastModified: '2026-03-01T00:00:00.000Z',
        history: [{ id: 'entry-legacy', question: 'q', toolCalls: [], answer: 'a', error: null }],
      }),
    )

    const loaded = await loadSession(projectPath, home)
    expect(loaded?.version).toBe(2)
    expect(loaded?.llmProvider).toBe('anthropic')
    expect(loaded?.agentSession).toEqual({ provider: 'anthropic', sessionId: 'claude-session-123' })

    // The migrated session now appears in listings and the flat file is gone.
    const summaries = await listSessions(home)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.lastModified).toBe('2026-03-01T00:00:00.000Z')
    expect(await Bun.file(legacyPath).exists()).toBe(false)
  })

  it('drops invalid OpenAI sessions with blank thread ids', async () => {
    const home = await tempHome()
    const projectPath = await tempProject()

    const sessionPath = getSessionFilePath(projectPath, 'bad-oai', home)
    await mkdir(path.dirname(sessionPath), { recursive: true })
    await Bun.write(
      sessionPath,
      JSON.stringify({
        version: 2,
        id: 'bad-oai',
        projectPath,
        llmProvider: 'openai',
        llmModel: 'gpt-4o',
        agentSession: { provider: 'openai', threadId: '' },
        lastModified: '2026-03-01T00:00:00.000Z',
        history: [],
      }),
    )

    const loaded = await loadSessionById(projectPath, 'bad-oai', home)
    expect(loaded).not.toBeNull()
    expect(loaded?.agentSession).toBeUndefined()
  })

  it('surfaces a legacy flat file in listSessions even before its project reopens', async () => {
    const home = await tempHome()
    const projectPath = await tempProject()

    const legacyPath = getLegacyPathForTest(projectPath, home)
    await mkdir(path.dirname(legacyPath), { recursive: true })
    await Bun.write(
      legacyPath,
      JSON.stringify({
        version: 1,
        projectPath,
        sessionId: 'claude-session-legacy',
        model: 'claude-haiku-4-5-20251001',
        lastModified: '2026-02-01T00:00:00.000Z',
        history: [{ id: 'e', question: 'legacy chat', toolCalls: [], answer: 'a', error: null }],
      }),
    )

    // listSessions alone (no per-project loadSession) must migrate and surface it.
    const summaries = await listSessions(home)
    expect(summaries.map((s) => s.preview)).toEqual(['legacy chat'])
    expect(summaries[0]?.lastModified).toBe('2026-02-01T00:00:00.000Z')
    expect(await Bun.file(legacyPath).exists()).toBe(false)

    // It is now resumable by its newly minted id.
    const migrated = summaries[0]
    if (!migrated) throw new Error('expected a migrated session')
    const resumed = await loadSessionById(projectPath, migrated.id, home)
    expect(resumed?.agentSession).toEqual({
      provider: 'anthropic',
      sessionId: 'claude-session-legacy',
    })
  })

  it('migrates the scoped project’s legacy flat file when listing one project', async () => {
    const home = await tempHome()
    const projectPath = await tempProject()

    const legacyPath = getLegacyPathForTest(projectPath, home)
    await mkdir(path.dirname(legacyPath), { recursive: true })
    await Bun.write(
      legacyPath,
      JSON.stringify({
        version: 1,
        projectPath,
        sessionId: 'claude-session-scoped',
        model: 'claude-haiku-4-5-20251001',
        lastModified: '2026-02-01T00:00:00.000Z',
        history: [
          { id: 'e', question: 'scoped legacy chat', toolCalls: [], answer: 'a', error: null },
        ],
      }),
    )

    const summaries = await listSessions(home, projectPath)
    expect(summaries.map((s) => s.preview)).toEqual(['scoped legacy chat'])
    expect(await Bun.file(legacyPath).exists()).toBe(false)
  })

  it('skips a corrupt history entry instead of crashing the listing', async () => {
    const home = await tempHome()
    const projectPath = await tempProject()

    const sessionPath = getSessionFilePath(projectPath, 'corrupt', home)
    await mkdir(path.dirname(sessionPath), { recursive: true })
    await Bun.write(
      sessionPath,
      JSON.stringify({
        version: 2,
        id: 'corrupt',
        projectPath,
        llmProvider: 'anthropic',
        llmModel: 'claude-haiku-4-5-20251001',
        lastModified: '2026-04-01T00:00:00.000Z',
        // First entry is malformed (no `question`); the second is real.
        history: [{}, { id: 'e', question: 'real question', toolCalls: [], answer: 'a' }],
      }),
    )

    const summaries = await listSessions(home)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.turnCount).toBe(2)
    expect(summaries[0]?.preview).toBe('real question')
  })

  it('uses a distinct temp file per concurrent save', async () => {
    const home = await tempHome()
    const projectPath = await tempProject()
    const session = makeSession(projectPath, { id: 'concurrent' })

    // Freeze the clock so the pre-fix `pid + Date.now()` temp name would collide
    // across these saves; the fix relies on a random suffix, so the temp paths
    // must stay distinct (and the final file uncorrupted) even then.
    const nowSpy = spyOn(Date, 'now').mockReturnValue(1_000_000)
    const writeSpy = spyOn(Bun, 'write')
    try {
      await Promise.all([
        saveSession(session, home),
        saveSession(session, home),
        saveSession(session, home),
      ])

      const tempPaths = writeSpy.mock.calls
        .map((call) => call[0])
        .filter((dest): dest is string => typeof dest === 'string' && dest.endsWith('.tmp'))
      expect(tempPaths).toHaveLength(3)
      expect(new Set(tempPaths).size).toBe(3)
    } finally {
      writeSpy.mockRestore()
      nowSpy.mockRestore()
    }

    const loaded = await loadSessionById(projectPath, 'concurrent', home)
    expect(loaded?.id).toBe('concurrent')
    expect(loaded?.history).toEqual(session.history)
  })
})
