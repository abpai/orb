import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  SlashCommandError,
  expandSlashCommandInput,
  getGlobalCommandsDir,
  getProjectCommandsDir,
  listAvailableSlashCommands,
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

    expect(result).toEqual({ kind: 'prompt', prompt: 'Explain this file' })
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

    expect(result.kind).toBe('prompt')
    if (result.kind !== 'prompt') throw new Error('expected prompt result')
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

    expect(result.kind).toBe('prompt')
    if (result.kind !== 'prompt') throw new Error('expected prompt result')
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

    expect(result.kind).toBe('prompt')
    if (result.kind !== 'prompt') throw new Error('expected prompt result')
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

  it('handles /help as a built-in local command', async () => {
    const result = await expandSlashCommandInput({
      input: '/help',
      projectPath: '/tmp/orb-project',
      homeDir: '/tmp/orb-home',
    })

    expect(result.kind).toBe('builtin')
    if (result.kind !== 'builtin') throw new Error('expected builtin result')
    expect(result.commandName).toBe('help')
    expect(result.answer).toContain('Slash commands')
    expect(result.answer).toContain('/commands')
  })

  it('prefers markdown command files over built-in names', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'orb-command-home-'))
    const projectDir = await mkdtemp(path.join(tmpdir(), 'orb-command-project-'))
    cleanupPaths.add(homeDir)
    cleanupPaths.add(projectDir)

    await writeCommand(getGlobalCommandsDir(homeDir), 'help', 'Global help prompt.')
    await writeCommand(getProjectCommandsDir(projectDir), 'help', 'Project help prompt.')

    const result = await expandSlashCommandInput({
      input: '/help',
      projectPath: projectDir,
      homeDir,
    })

    expect(result.kind).toBe('prompt')
    if (result.kind !== 'prompt') throw new Error('expected prompt result')
    expect(result.prompt).toBe('Project help prompt.')
    expect(result.sourcePath).toBe(path.join(getProjectCommandsDir(projectDir), 'help.md'))
  })

  it('lists built-ins and markdown commands for /commands', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'orb-command-home-'))
    const projectDir = await mkdtemp(path.join(tmpdir(), 'orb-command-project-'))
    cleanupPaths.add(homeDir)
    cleanupPaths.add(projectDir)

    await writeCommand(getGlobalCommandsDir(homeDir), 'alpha', 'Global alpha')
    await writeCommand(getGlobalCommandsDir(homeDir), 'shared', 'Global shared')
    await writeCommand(getProjectCommandsDir(projectDir), 'beta', 'Project beta')
    await writeCommand(getProjectCommandsDir(projectDir), 'shared', 'Project shared')

    const result = await expandSlashCommandInput({
      input: '/commands',
      projectPath: projectDir,
      homeDir,
    })

    expect(result.kind).toBe('builtin')
    if (result.kind !== 'builtin') throw new Error('expected builtin result')
    expect(result.answer).toContain('- /help (built-in)')
    expect(result.answer).toContain('- /commands (built-in)')
    expect(result.answer).toContain('- /alpha (global)')
    expect(result.answer).toContain('- /beta (project)')
    expect(result.answer).toContain('- /shared (project, overrides global)')
  })
})

describe('listAvailableSlashCommands', () => {
  it('merges project, global, and built-in commands with project precedence', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'orb-command-home-'))
    const projectDir = await mkdtemp(path.join(tmpdir(), 'orb-command-project-'))
    cleanupPaths.add(homeDir)
    cleanupPaths.add(projectDir)

    await writeCommand(getGlobalCommandsDir(homeDir), 'shared', 'Global shared')
    await writeCommand(getProjectCommandsDir(projectDir), 'shared', 'Project shared')
    await writeCommand(getProjectCommandsDir(projectDir), 'local', 'Project local')

    const commands = await listAvailableSlashCommands({
      projectPath: projectDir,
      homeDir,
    })

    expect(
      commands.map((command) => [command.name, command.source, command.shadowedSources ?? []]),
    ).toEqual([
      ['commands', 'builtin', []],
      ['help', 'builtin', []],
      ['local', 'project', []],
      ['shared', 'project', ['global']],
    ])
  })

  it('shows builtin names as overridden when files reuse them', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'orb-command-home-'))
    const projectDir = await mkdtemp(path.join(tmpdir(), 'orb-command-project-'))
    cleanupPaths.add(homeDir)
    cleanupPaths.add(projectDir)

    await writeCommand(getGlobalCommandsDir(homeDir), 'help', 'Global help')
    await writeCommand(getProjectCommandsDir(projectDir), 'help', 'Project help')

    const commands = await listAvailableSlashCommands({
      projectPath: projectDir,
      homeDir,
    })

    expect(commands.find((command) => command.name === 'help')).toEqual({
      name: 'help',
      source: 'project',
      path: path.join(getProjectCommandsDir(projectDir), 'help.md'),
      shadowedSources: ['global', 'builtin'],
    })
  })
})
