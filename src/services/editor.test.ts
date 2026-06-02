import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { openInEditor, formatOpenOutcome, type EditorLauncher } from './editor'

const tempDirs: string[] = []

async function createProject(files: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orb-editor-'))
  tempDirs.push(dir)
  for (const file of files) {
    await writeFile(join(dir, file), '// content\n')
  }
  return dir
}

/** Records every launch and reports success. */
function recordingLauncher(): { launch: EditorLauncher; calls: string[][] } {
  const calls: string[][] = []
  const launch: EditorLauncher = async (command, args) => {
    calls.push([command, ...args])
    return { ok: true }
  }
  return { launch, calls }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('openInEditor', () => {
  it('opens an existing project file with reuse-window goto args', async () => {
    const dir = await createProject(['a.ts'])
    const { launch, calls } = recordingLauncher()

    const outcome = await openInEditor([{ path: 'a.ts', line: 12 }], {
      projectPath: dir,
      launch,
      editorCommand: 'cursor',
    })

    expect(outcome.opened).toHaveLength(1)
    expect(outcome.opened[0]?.path).toBe('a.ts')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.slice(0, 3)).toEqual(['cursor', '--reuse-window', '--goto'])
    expect(calls[0]?.[3]).toMatch(/a\.ts:12$/)
  })

  it('refuses files outside the project root', async () => {
    const dir = await createProject(['a.ts'])
    const { launch, calls } = recordingLauncher()

    const outcome = await openInEditor([{ path: '/etc/hosts' }], { projectPath: dir, launch })

    expect(outcome.opened).toHaveLength(0)
    expect(outcome.outsideProject).toEqual([{ path: '/etc/hosts' }])
    expect(calls).toHaveLength(0)
  })

  it('reports refs that do not exist on disk', async () => {
    const dir = await createProject(['a.ts'])
    const { launch } = recordingLauncher()

    const outcome = await openInEditor([{ path: 'missing.ts' }], { projectPath: dir, launch })

    expect(outcome.opened).toHaveLength(0)
    expect(outcome.notFound).toEqual([{ path: 'missing.ts' }])
  })

  it('refuses a directory (opens files, not folders)', async () => {
    const dir = await createProject([])
    await mkdir(join(dir, 'pkg'))
    const { launch, calls } = recordingLauncher()

    const outcome = await openInEditor([{ path: 'pkg' }], { projectPath: dir, launch })

    expect(outcome.opened).toHaveLength(0)
    expect(outcome.notFound).toEqual([{ path: 'pkg' }])
    expect(calls).toHaveLength(0)
  })

  it('caps the number of files and reports the rest as held back', async () => {
    const dir = await createProject(['a.ts', 'b.ts', 'c.ts'])
    const { launch, calls } = recordingLauncher()

    const outcome = await openInEditor([{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }], {
      projectPath: dir,
      launch,
      maxFiles: 2,
    })

    expect(outcome.opened.map((r) => r.path)).toEqual(['a.ts', 'b.ts'])
    expect(outcome.heldBack.map((r) => r.path)).toEqual(['c.ts'])
    expect(calls).toHaveLength(2)
  })

  it('dedupes refs that resolve to the same file', async () => {
    const dir = await createProject(['a.ts'])
    const { launch, calls } = recordingLauncher()

    const outcome = await openInEditor([{ path: 'a.ts' }, { path: './a.ts' }], {
      projectPath: dir,
      launch,
    })

    expect(outcome.opened).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('flags a missing editor binary', async () => {
    const dir = await createProject(['a.ts'])
    const launch: EditorLauncher = async () => ({ ok: false, missing: true, error: 'not found' })

    const outcome = await openInEditor([{ path: 'a.ts' }], { projectPath: dir, launch })

    expect(outcome.editorMissing).toBe(true)
    expect(outcome.opened).toHaveLength(0)
  })

  it('does nothing for an empty ref list', async () => {
    const dir = await createProject([])
    const { launch, calls } = recordingLauncher()
    const outcome = await openInEditor([], { projectPath: dir, launch })
    expect(outcome.opened).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })
})

describe('formatOpenOutcome', () => {
  it('summarizes opened files and held-back count', () => {
    const message = formatOpenOutcome({
      opened: [{ path: 'a.ts', line: 3, resolved: '/p/a.ts' }],
      outsideProject: [],
      notFound: [],
      heldBack: [{ path: 'b.ts' }],
      editorMissing: false,
    })
    expect(message).toContain('Opened a.ts:3 in Cursor.')
    expect(message).toContain('Held back 1 more.')
  })

  it('explains a missing editor', () => {
    const message = formatOpenOutcome({
      opened: [],
      outsideProject: [],
      notFound: [],
      heldBack: [],
      editorMissing: true,
    })
    expect(message).toContain("isn't on your PATH")
  })

  it('falls back to a helpful nudge when there is nothing to open', () => {
    const message = formatOpenOutcome({
      opened: [],
      outsideProject: [],
      notFound: [],
      heldBack: [],
      editorMissing: false,
    })
    expect(message).toContain('No files to open yet')
  })
})
