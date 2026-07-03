import { afterEach, describe, expect, it, mock } from 'bun:test'

import { ORB_VERSION } from './config'
import { DEFAULT_CONFIG, type SavedSession } from './types'

async function importIndex() {
  return await import('./index')
}

afterEach(() => {
  mock.restore()
})

describe('run', () => {
  it('handles --version before loading config or rendering the app', async () => {
    const originalWrite = process.stdout.write
    let stdout = ''

    Object.defineProperty(process.stdout, 'write', {
      value: ((chunk: string | Uint8Array) => {
        stdout += String(chunk)
        return true
      }) as typeof process.stdout.write,
      configurable: true,
    })

    try {
      const { run } = await importIndex()
      let thrown: unknown

      try {
        await run(['--version'])
      } catch (error) {
        thrown = error
      }

      expect(thrown).toMatchObject({ exitCode: 0 })
      expect(stdout.trim()).toBe(ORB_VERSION)
    } finally {
      Object.defineProperty(process.stdout, 'write', {
        value: originalWrite,
        configurable: true,
      })
    }
  })

  it('fires gateway warmup without awaiting or surfacing rejection', async () => {
    const originalFetch = globalThis.fetch
    const requests: string[] = []
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      requests.push(typeof input === 'string' ? input : input.toString())
      throw new Error('still cold')
    }) as unknown as typeof globalThis.fetch

    try {
      const { warmGatewayForStartup } = await importIndex()
      warmGatewayForStartup({
        ...DEFAULT_CONFIG,
        ttsEnabled: true,
        ttsMode: 'serve',
        ttsServerUrl: 'http://localhost:8000',
      })

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(requests).toEqual(['http://localhost:8000/warmup'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('createInitialSession', () => {
  it('uses an explicit Claude handoff session instead of unrelated saved state', async () => {
    const { createInitialSession } = await importIndex()
    const savedSession: SavedSession = {
      version: 2,
      id: 'saved-1',
      projectPath: '/tmp/project',
      llmProvider: 'openai',
      llmModel: 'gpt-5.5',
      agentSession: { provider: 'openai', threadId: 'thread-old' },
      lastModified: '2026-05-01T00:00:00.000Z',
      history: [{ id: 'old', question: 'q', toolCalls: [], answer: 'a', error: null }],
    }

    expect(
      createInitialSession(
        {
          ...DEFAULT_CONFIG,
          projectPath: '/tmp/project',
          llmProvider: 'anthropic',
          llmModel: 'claude-opus-4-8',
          resumeSession: { provider: 'anthropic', sessionId: 'claude-session-1' },
        },
        savedSession,
      ),
    ).toEqual(
      expect.objectContaining({
        llmProvider: 'anthropic',
        agentSession: { provider: 'anthropic', sessionId: 'claude-session-1' },
        history: [],
      }),
    )
  })

  it('keeps saved history when the handoff session matches', async () => {
    const { createInitialSession } = await importIndex()
    const savedSession: SavedSession = {
      version: 2,
      id: 'saved-1',
      projectPath: '/tmp/project',
      llmProvider: 'openai',
      llmModel: 'gpt-5.5',
      agentSession: { provider: 'openai', threadId: 'thread-1' },
      lastModified: '2026-05-01T00:00:00.000Z',
      history: [{ id: 'old', question: 'q', toolCalls: [], answer: 'a', error: null }],
    }

    expect(
      createInitialSession(
        {
          ...DEFAULT_CONFIG,
          projectPath: '/tmp/project',
          llmProvider: 'openai',
          llmModel: 'gpt-5.5',
          resumeSession: { provider: 'openai', threadId: 'thread-1' },
        },
        savedSession,
      )?.history,
    ).toEqual(savedSession.history)
  })

  it('honors --new by clearing visible history even with a handoff session', async () => {
    const { createInitialSession } = await importIndex()
    const savedSession: SavedSession = {
      version: 2,
      id: 'saved-1',
      projectPath: '/tmp/project',
      llmProvider: 'openai',
      llmModel: 'gpt-5.5',
      agentSession: { provider: 'openai', threadId: 'thread-1' },
      lastModified: '2026-05-01T00:00:00.000Z',
      history: [{ id: 'old', question: 'q', toolCalls: [], answer: 'a', error: null }],
    }

    expect(
      createInitialSession(
        {
          ...DEFAULT_CONFIG,
          projectPath: '/tmp/project',
          startFresh: true,
          resumeSession: { provider: 'openai', threadId: 'thread-1' },
        },
        savedSession,
      )?.history,
    ).toEqual([])
  })
})
