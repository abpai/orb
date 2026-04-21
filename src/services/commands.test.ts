import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  SlashCommandError,
  expandSlashCommandInput,
  getGlobalCommandsDir,
  getProjectCommandsDir,
} from './commands'

const cleanupPaths = new Set<string>()

afterEach(async () => {
  await Promise.all([...cleanupPaths].map((target) => rm(target, { recursive: true, force: true })))
  cleanupPaths.clear()
})

async function writeCommand(commandsDir: string, name: string, contents: string) {
  await mkdir(commandsDir, { recursive: true })
  await writeFile(path.join(commandsDir, `${name}.md`), contents)
}

describe('expandSlashCommandInput', () => {
  it('leaves normal prompts unchanged', async () => {
    const result = await expandSlashCommandInput({
      input: 'Explain this file',
      projectPath: '/tmp/orb-project',
      homeDir: '/tmp/orb-home',
    })

    expect(result).toEqual({ prompt: 'Explain this file' })
  })

  it('resolves a global slash command', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'orb-command-home-'))
    cleanupPaths.add(homeDir)

    await writeCommand(getGlobalCommandsDir(homeDir), 'explain', 'Explain the selected code.')

    const result = await expandSlashCommandInput({
      input: '/explain',
      projectPath: '/tmp/orb-project',
      homeDir,
    })

    expect(result.prompt).toBe('Explain the selected code.')
    expect(result.sourcePath).toBe(path.join(getGlobalCommandsDir(homeDir), 'explain.md'))
  })

  it('prefers the project-local command over the global one', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'orb-command-home-'))
    const projectDir = await mkdtemp(path.join(tmpdir(), 'orb-command-project-'))
    cleanupPaths.add(homeDir)
    cleanupPaths.add(projectDir)

    await writeCommand(getGlobalCommandsDir(homeDir), 'explain', 'Global explain prompt.')
    await writeCommand(getProjectCommandsDir(projectDir), 'explain', 'Local explain prompt.')

    const result = await expandSlashCommandInput({
      input: '/explain',
      projectPath: projectDir,
      homeDir,
    })

    expect(result.prompt).toBe('Local explain prompt.')
    expect(result.sourcePath).toBe(path.join(getProjectCommandsDir(projectDir), 'explain.md'))
  })

  it('appends trailing text after the command template', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'orb-command-home-'))
    cleanupPaths.add(homeDir)

    await writeCommand(getGlobalCommandsDir(homeDir), 'explain', 'Explain the selected code.')

    const result = await expandSlashCommandInput({
      input: '/explain why is this failing?',
      projectPath: '/tmp/orb-project',
      homeDir,
    })

    expect(result.prompt).toBe('Explain the selected code.\n\nwhy is this failing?')
  })

  it('throws a clear error when the slash command is missing', async () => {
    await expect(
      expandSlashCommandInput({
        input: '/missing',
        projectPath: '/tmp/orb-project',
        homeDir: '/tmp/orb-home',
      }),
    ).rejects.toThrow('Slash command "/missing" not found.')
  })

  it('rejects empty command files', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'orb-command-home-'))
    cleanupPaths.add(homeDir)

    await writeCommand(getGlobalCommandsDir(homeDir), 'explain', '\n  \n')

    await expect(
      expandSlashCommandInput({
        input: '/explain',
        projectPath: '/tmp/orb-project',
        homeDir,
      }),
    ).rejects.toThrow(SlashCommandError)
  })
})
