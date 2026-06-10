import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { SavedSession } from '../types'
import { modelCachePath } from './orb-paths'
import { resolveRuntimeConfig } from './runtime-config'
import { saveSession } from './session'

const cleanupPaths = new Set<string>()

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  cleanupPaths.add(dir)
  return dir
}

async function seedModelCache(homeDir: string): Promise<void> {
  const cachePath = modelCachePath(homeDir)
  await mkdir(path.dirname(cachePath), { recursive: true })
  await Bun.write(
    cachePath,
    JSON.stringify(
      {
        fetchedAt: Date.now(),
        models: [
          {
            gatewayId: 'openai/gpt-5.5',
            provider: 'openai',
            nativeId: 'gpt-5.5',
            name: 'GPT 5.5',
            type: 'language',
            tags: ['tool-use'],
          },
          {
            gatewayId: 'openai/gpt-4o',
            provider: 'openai',
            nativeId: 'gpt-4o',
            name: 'GPT 4o',
            type: 'language',
            tags: ['tool-use'],
          },
        ],
      },
      null,
      2,
    ),
  )
}

function savedSession(projectPath: string, overrides: Partial<SavedSession> = {}): SavedSession {
  return {
    version: 2,
    id: 'saved-1',
    projectPath,
    llmProvider: 'openai',
    llmModel: 'gpt-4o',
    agentSession: { provider: 'openai', threadId: 'thread-1' },
    lastModified: '2026-06-01T00:00:00.000Z',
    history: [{ id: 'entry-1', question: 'old question', toolCalls: [], answer: 'old answer' }],
    ...overrides,
  }
}

describe('resolveRuntimeConfig resume overrides', () => {
  afterEach(async () => {
    for (const cleanupPath of cleanupPaths) {
      await rm(cleanupPath, { recursive: true, force: true })
    }
    cleanupPaths.clear()
  })

  it('keeps saved model/provider when only config-file defaults exist', async () => {
    const homeDir = await tempDir('orb-runtime-home-')
    const projectPath = await tempDir('orb-runtime-project-')
    await seedModelCache(homeDir)
    await mkdir(path.join(homeDir, '.orb'), { recursive: true })
    await Bun.write(
      path.join(homeDir, '.orb', 'config.toml'),
      'provider = "openai"\nmodel = "gpt-5.5"\n',
    )
    await saveSession(savedSession(projectPath), homeDir)

    const result = await resolveRuntimeConfig([projectPath, '--resume', 'saved-1'], homeDir)

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.config.llmModel).toBe('gpt-4o')
    expect(result.initialSession?.llmModel).toBe('gpt-4o')
  })

  it('lets explicit CLI model/provider override a saved session resume', async () => {
    const homeDir = await tempDir('orb-runtime-home-')
    const projectPath = await tempDir('orb-runtime-project-')
    await seedModelCache(homeDir)
    await saveSession(savedSession(projectPath), homeDir)

    const result = await resolveRuntimeConfig(
      [projectPath, '--resume', 'saved-1', '--provider=openai', '--model=gpt-5.5'],
      homeDir,
    )

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.config.llmProvider).toBe('openai')
    expect(result.config.llmModel).toBe('gpt-5.5')
    expect(result.initialSession).toMatchObject({
      llmProvider: 'openai',
      llmModel: 'gpt-5.5',
      agentSession: { provider: 'openai', threadId: 'thread-1' },
      history: [{ question: 'old question', answer: 'old answer' }],
    })
  })
})
