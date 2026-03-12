import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { SavedSession } from '../../types'
import { getSessionPath, loadSession, saveSession } from '../session'

describe('session persistence', () => {
  let tempProjectRoot = ''
  const cleanupPaths = new Set<string>()

  afterEach(async () => {
    for (const cleanupPath of cleanupPaths) {
      await rm(cleanupPath, { recursive: true, force: true })
    }
    cleanupPaths.clear()
  })

  it('round-trips a v2 session payload', async () => {
    tempProjectRoot = await mkdtemp(path.join(tmpdir(), 'orb-project-'))
    cleanupPaths.add(tempProjectRoot)
    const projectPath = path.join(tempProjectRoot, 'project')
    await mkdir(projectPath, { recursive: true })

    const session: SavedSession = {
      version: 2,
      projectPath,
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      agentSession: {
        provider: 'openai',
        messages: [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ],
      },
      lastModified: new Date().toISOString(),
      history: [{ id: 'entry-1', question: 'hello', toolCalls: [], answer: 'hi', error: null }],
    }

    cleanupPaths.add(getSessionPath(projectPath))
    await saveSession(session)
    const loaded = await loadSession(projectPath)

    expect(loaded).not.toBeNull()
    expect(loaded?.llmProvider).toBe('openai')
    expect(loaded?.llmModel).toBe('gpt-4o')
    expect(loaded?.agentSession).toEqual(session.agentSession)
    expect(loaded?.history).toEqual(session.history)
  })

  it('migrates a v1 Anthropic session on load', async () => {
    tempProjectRoot = await mkdtemp(path.join(tmpdir(), 'orb-project-'))
    cleanupPaths.add(tempProjectRoot)
    const projectPath = path.join(tempProjectRoot, 'legacy-project')
    await mkdir(projectPath, { recursive: true })

    const sessionPath = getSessionPath(projectPath)
    cleanupPaths.add(sessionPath)
    await mkdir(path.dirname(sessionPath), { recursive: true })
    await Bun.write(
      sessionPath,
      JSON.stringify({
        version: 1,
        projectPath,
        sessionId: 'claude-session-123',
        model: 'claude-haiku-4-5-20251001',
        lastModified: '2026-03-01T00:00:00.000Z',
        history: [{ id: 'entry-legacy', question: 'q', toolCalls: [], answer: 'a', error: null }],
      }),
    )

    const loaded = await loadSession(projectPath)

    expect(loaded).not.toBeNull()
    expect(loaded?.version).toBe(2)
    expect(loaded?.llmProvider).toBe('anthropic')
    expect(loaded?.agentSession).toEqual({
      provider: 'anthropic',
      sessionId: 'claude-session-123',
    })
  })
})
