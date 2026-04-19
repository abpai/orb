import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { createCanUseTool } from './anthropic'

describe('createCanUseTool', () => {
  const permissionContext = {
    signal: new AbortController().signal,
    toolUseID: 'tool-1',
  }

  it('allows writes inside the project root', async () => {
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orb-anthropic-')))
    const canUseTool = createCanUseTool(projectRoot)

    try {
      await expect(
        canUseTool('Write', { file_path: 'src/example.ts' }, permissionContext),
      ).resolves.toEqual({
        behavior: 'allow',
      })
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it('denies writes outside the project root', async () => {
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orb-anthropic-')))
    const canUseTool = createCanUseTool(projectRoot)

    try {
      await expect(
        canUseTool('Write', { file_path: '../outside.ts' }, permissionContext),
      ).resolves.toMatchObject({
        behavior: 'deny',
      })
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it('denies symlink escapes for existing files and new files under the symlink', async () => {
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orb-anthropic-')))
    const escapeTarget = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orb-escape-')))
    const canUseTool = createCanUseTool(projectRoot)
    const linkPath = path.join(projectRoot, 'escape-link')
    fs.writeFileSync(path.join(escapeTarget, 'secret.txt'), 'secret\n')
    fs.symlinkSync(escapeTarget, linkPath)

    try {
      await expect(
        canUseTool('Write', { file_path: 'escape-link/secret.txt' }, permissionContext),
      ).resolves.toMatchObject({
        behavior: 'deny',
      })
      await expect(
        canUseTool('Write', { file_path: 'escape-link/created.txt' }, permissionContext),
      ).resolves.toMatchObject({
        behavior: 'deny',
      })
    } finally {
      fs.rmSync(linkPath, { force: true })
      fs.rmSync(projectRoot, { recursive: true, force: true })
      fs.rmSync(escapeTarget, { recursive: true, force: true })
    }
  })
})
