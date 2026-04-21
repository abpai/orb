import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { installDefaultCommands, listBundledDefaultCommands } from './default-commands'

const cleanupPaths = new Set<string>()

afterEach(async () => {
  await Promise.all([...cleanupPaths].map((target) => rm(target, { recursive: true, force: true })))
  cleanupPaths.clear()
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  cleanupPaths.add(dir)
  return dir
}

async function seedSource(dir: string, files: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true })
  await Promise.all(
    Object.entries(files).map(([name, contents]) => writeFile(path.join(dir, name), contents)),
  )
}

describe('listBundledDefaultCommands', () => {
  it('returns sorted markdown commands', async () => {
    const sourceDir = await makeTempDir('orb-defaults-src-')
    await seedSource(sourceDir, {
      'tour.md': 'tour',
      'explain.md': 'explain',
      'quiz.md': 'quiz',
      'ignore.txt': 'not a command',
    })

    const commands = await listBundledDefaultCommands(sourceDir)
    expect(commands.map((command) => command.name)).toEqual(['explain', 'quiz', 'tour'])
  })

  it('returns an empty list when the source directory is missing', async () => {
    const commands = await listBundledDefaultCommands(path.join(tmpdir(), 'orb-missing-defaults'))
    expect(commands).toEqual([])
  })

  it('ships the canonical defaults from the repo', async () => {
    const commands = await listBundledDefaultCommands()
    expect(commands.map((command) => command.name)).toEqual(['explain', 'quiz', 'tour'])
  })
})

describe('installDefaultCommands', () => {
  it('copies every bundled command into the target directory', async () => {
    const sourceDir = await makeTempDir('orb-defaults-src-')
    const targetDir = path.join(await makeTempDir('orb-defaults-target-'), 'commands')
    await seedSource(sourceDir, {
      'tour.md': 'Tour template',
      'explain.md': 'Explain template',
    })

    const result = await installDefaultCommands({ sourceDir, targetDir })

    expect(result.installed.sort()).toEqual(['explain', 'tour'])
    expect(result.skipped).toEqual([])
    expect(result.targetDir).toBe(targetDir)
    expect(await readFile(path.join(targetDir, 'tour.md'), 'utf8')).toBe('Tour template')
    expect(await readFile(path.join(targetDir, 'explain.md'), 'utf8')).toBe('Explain template')
  })

  it('skips existing files without overwriting user edits', async () => {
    const sourceDir = await makeTempDir('orb-defaults-src-')
    const targetDir = path.join(await makeTempDir('orb-defaults-target-'), 'commands')
    await seedSource(sourceDir, {
      'tour.md': 'Bundled tour',
      'explain.md': 'Bundled explain',
    })
    await mkdir(targetDir, { recursive: true })
    await writeFile(path.join(targetDir, 'tour.md'), 'User-edited tour')

    const result = await installDefaultCommands({ sourceDir, targetDir })

    expect(result.installed).toEqual(['explain'])
    expect(result.skipped).toEqual(['tour'])
    expect(await readFile(path.join(targetDir, 'tour.md'), 'utf8')).toBe('User-edited tour')
    expect(await readFile(path.join(targetDir, 'explain.md'), 'utf8')).toBe('Bundled explain')
  })

  it('handles a missing source directory gracefully', async () => {
    const targetDir = path.join(await makeTempDir('orb-defaults-target-'), 'commands')

    const result = await installDefaultCommands({
      sourceDir: path.join(tmpdir(), 'orb-missing-defaults'),
      targetDir,
    })

    expect(result.installed).toEqual([])
    expect(result.skipped).toEqual([])
  })
})
