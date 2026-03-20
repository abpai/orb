/**
 * scratch/06-session-persistence.ts — Session Persistence
 *
 * Proves:
 *   1. Real v1→v2 migration
 *   2. Provider/session normalization on load
 *   3. saveSession() rewriting paths and timestamps
 *
 * Run:
 *   bun run scratch/06-session-persistence.ts
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getSessionPath, loadSession, saveSession } from '../src/services/session'
import type { SavedSession } from '../src/types'

const tempRoots = new Set<string>()
const sessionFiles = new Set<string>()

async function createProject(name: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `orb-session-${name}-`))
  const projectPath = path.join(root, 'project')
  tempRoots.add(root)
  await mkdir(projectPath, { recursive: true })
  return projectPath
}

async function writeFixture(projectPath: string, payload: unknown): Promise<string> {
  const sessionPath = getSessionPath(projectPath)
  sessionFiles.add(sessionPath)
  await mkdir(path.dirname(sessionPath), { recursive: true })
  await Bun.write(sessionPath, JSON.stringify(payload, null, 2))
  return sessionPath
}

async function cleanup(): Promise<void> {
  for (const file of sessionFiles) {
    await rm(file, { force: true })
  }
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true })
  }
}

console.log('╭─────────────────────────────────────────╮')
console.log('│  06 · Session Persistence                │')
console.log('╰─────────────────────────────────────────╯\n')

try {
  const sampleProject = await createProject('path')
  const sampleSessionPath = getSessionPath(sampleProject)
  console.log('─── Session Path ───\n')
  console.log(`  project path → ${sampleProject}`)
  console.log(`  session file → ${sampleSessionPath}`)
  console.log()

  console.log('─── V1 → V2 Migration ───\n')
  {
    const projectPath = await createProject('legacy')
    await writeFixture(projectPath, {
      version: 1,
      projectPath,
      sessionId: 'claude-session-123',
      model: 'claude-haiku-4-5-20251001',
      lastModified: '2026-03-01T00:00:00.000Z',
      history: [{ id: 'legacy-1', question: 'q', toolCalls: [], answer: 'a', error: null }],
    })

    const loaded = await loadSession(projectPath)
    console.log(`  version      → ${loaded?.version}`)
    console.log(`  llmProvider  → ${loaded?.llmProvider}`)
    console.log(`  llmModel     → ${loaded?.llmModel}`)
    console.log(`  agentSession → ${JSON.stringify(loaded?.agentSession)}`)
  }

  console.log('\n─── Invalid Provider Normalization ───\n')
  {
    const projectPath = await createProject('bogus-provider')
    await writeFixture(projectPath, {
      version: 2,
      projectPath,
      llmProvider: 'bogus',
      llmModel: 'mystery-model',
      lastModified: '2026-03-01T00:00:00.000Z',
      history: [],
    })

    const loaded = await loadSession(projectPath)
    console.log('  stored provider → "bogus"')
    console.log(`  loaded provider → ${loaded?.llmProvider}`)
  }

  console.log('\n─── Invalid OpenAI Session Payloads Are Dropped ───\n')
  {
    const projectPath = await createProject('bad-openai')
    await writeFixture(projectPath, {
      version: 2,
      projectPath,
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      agentSession: {
        provider: 'openai',
        previousResponseId: '',
      },
      lastModified: '2026-03-01T00:00:00.000Z',
      history: [],
    })

    const loaded = await loadSession(projectPath)
    console.log(`  loaded agentSession → ${JSON.stringify(loaded?.agentSession)}`)
  }

  console.log('\n─── Wrong Project Path Returns null ───\n')
  {
    const projectPath = await createProject('wrong-project')
    await writeFixture(projectPath, {
      version: 2,
      projectPath: `${projectPath}-different`,
      llmProvider: 'anthropic',
      llmModel: 'claude-haiku-4-5-20251001',
      lastModified: '2026-03-01T00:00:00.000Z',
      history: [],
    })

    const loaded = await loadSession(projectPath)
    console.log(`  loadSession(projectPath) → ${loaded}`)
  }

  console.log('\n─── saveSession() Rewrites Paths and Timestamps ───\n')
  {
    const projectPath = await createProject('save')
    const relativeProjectPath = path.relative(process.cwd(), projectPath)
    const before = '2000-01-01T00:00:00.000Z'

    const session: SavedSession = {
      version: 2,
      projectPath: relativeProjectPath,
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      agentSession: {
        provider: 'openai',
        previousResponseId: 'resp_123',
      },
      lastModified: before,
      history: [],
    }

    await saveSession(session)
    const sessionPath = getSessionPath(relativeProjectPath)
    sessionFiles.add(sessionPath)
    const raw = JSON.parse(await readFile(sessionPath, 'utf8')) as SavedSession

    console.log(`  input projectPath   → ${relativeProjectPath}`)
    console.log(`  stored projectPath  → ${raw.projectPath}`)
    console.log(`  input lastModified  → ${before}`)
    console.log(`  stored lastModified → ${raw.lastModified}`)
  }

  console.log('\n  Note: every loadSession() call still triggers cleanupOldSessions() in ~/.orb/sessions/.')
} finally {
  await cleanup()
}
