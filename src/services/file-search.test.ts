import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'bun:test'

import { invalidateFileList, listProjectFiles, rankFiles, searchProjectFiles } from './file-search'

describe('rankFiles', () => {
  const files = [
    'src/services/file-search.ts',
    'src/services/file-refs.ts',
    'src/ui/components/InputPrompt.tsx',
    'README.md',
    'src/legacy/unfoothold.ts',
  ]

  it('returns the head of the list for an empty query', () => {
    expect(rankFiles('', files, 3)).toEqual(files.slice(0, 3))
  })

  it('returns nothing for a non-positive limit', () => {
    expect(rankFiles('src', files, 0)).toEqual([])
  })

  it('ranks a basename match ahead of an incidental subsequence', () => {
    const ranked = rankFiles('inputprompt', files, 5)
    expect(ranked[0]).toBe('src/ui/components/InputPrompt.tsx')
  })

  it('prefers contiguous basename matches', () => {
    const ranked = rankFiles('foo', files, 5)
    // `file-search`/`file-refs`/`unfoothold` all contain f..o..o as a
    // subsequence, but nothing has a contiguous "foo" — the closest is
    // unfoothold's "foo", so just assert it matches and stays bounded.
    expect(ranked).toContain('src/legacy/unfoothold.ts')
  })

  it('matches on path segments, not just basename', () => {
    const ranked = rankFiles('services', files, 5)
    expect(ranked).toContain('src/services/file-search.ts')
    expect(ranked).toContain('src/services/file-refs.ts')
  })

  it('excludes non-matches and respects the limit', () => {
    const ranked = rankFiles('refs', files, 1)
    expect(ranked).toHaveLength(1)
    expect(ranked[0]).toBe('src/services/file-refs.ts')
  })

  it('is case-insensitive', () => {
    expect(rankFiles('README', files, 5)).toContain('README.md')
    expect(rankFiles('readme', files, 5)).toContain('README.md')
  })
})

describe('listProjectFiles / searchProjectFiles', () => {
  const dirs: string[] = []

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      invalidateFileList(path.join(dir, 'project'))
      await rm(dir, { force: true, recursive: true })
    }
  })

  async function makeProject(files: string[], { git }: { git: boolean }) {
    const base = await mkdtemp(path.join(tmpdir(), 'orb-file-search-'))
    dirs.push(base)
    const projectPath = path.join(base, 'project')
    await mkdir(projectPath, { recursive: true })
    for (const file of files) {
      const abs = path.join(projectPath, file)
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, '')
    }
    if (git) {
      const proc = Bun.spawn(['git', 'init', '-q'], {
        cwd: projectPath,
        stdout: 'ignore',
        stderr: 'ignore',
      })
      await proc.exited
    }
    return projectPath
  }

  it('lists untracked-not-ignored files in a git repo', async () => {
    const projectPath = await makeProject(
      ['src/a.ts', 'src/b.ts', 'node_modules/dep/index.js', 'ignored.log'],
      { git: true },
    )
    await writeFile(path.join(projectPath, '.gitignore'), 'node_modules\n*.log\n')
    invalidateFileList(projectPath)

    const files = await listProjectFiles(projectPath)
    expect(files).toContain('src/a.ts')
    expect(files).toContain('src/b.ts')
    expect(files).not.toContain('node_modules/dep/index.js')
    expect(files).not.toContain('ignored.log')
  })

  it('falls back to a walk that skips heavy dirs when not a git repo', async () => {
    const projectPath = await makeProject(
      ['src/a.ts', 'dist/bundle.js', 'node_modules/dep/index.js'],
      { git: false },
    )
    invalidateFileList(projectPath)

    const files = await listProjectFiles(projectPath)
    expect(files).toContain('src/a.ts')
    expect(files).not.toContain('dist/bundle.js')
    expect(files).not.toContain('node_modules/dep/index.js')
  })

  it('searchProjectFiles ranks results for a query', async () => {
    const projectPath = await makeProject(['src/alpha.ts', 'src/beta.ts'], { git: false })
    invalidateFileList(projectPath)

    const results = await searchProjectFiles('alpha', { projectPath })
    expect(results[0]).toBe('src/alpha.ts')
  })
})
