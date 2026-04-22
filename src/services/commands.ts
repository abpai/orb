import { readdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const ORB_DIR = '.orb'
const COMMANDS_DIR = 'commands'
const BUILTIN_COMMANDS = ['help', 'commands'] as const

type BuiltinCommandName = (typeof BUILTIN_COMMANDS)[number]

export class SlashCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlashCommandError'
  }
}

interface ParsedSlashCommand {
  name: string
  trailingText?: string
}

export interface ExpandedPrompt {
  kind: 'prompt'
  prompt: string
  commandName?: string
  sourcePath?: string
}

export interface BuiltinSlashCommand {
  kind: 'builtin'
  commandName: BuiltinCommandName
  answer: string
}

export type SlashCommandResolution = ExpandedPrompt | BuiltinSlashCommand

export interface ExpandSlashCommandOptions {
  input: string
  projectPath: string
  homeDir?: string
}

export interface AvailableSlashCommand {
  name: string
  source: 'project' | 'global' | 'builtin'
  path?: string
  shadowedSources?: Array<'project' | 'global' | 'builtin'>
}

function mergeCommand(
  merged: Map<string, AvailableSlashCommand>,
  command: AvailableSlashCommand,
): void {
  const existing = merged.get(command.name)
  merged.set(command.name, {
    ...command,
    shadowedSources: existing ? [existing.source, ...(existing.shadowedSources ?? [])] : [],
  })
}

export function getGlobalCommandsDir(homeDir = os.homedir()): string {
  return path.join(homeDir, ORB_DIR, COMMANDS_DIR)
}

export function getProjectCommandsDir(projectPath: string): string {
  return path.join(path.resolve(projectPath), ORB_DIR, COMMANDS_DIR)
}

function getCommandPath(commandsDir: string, commandName: string): string {
  return path.join(commandsDir, `${commandName}.md`)
}

function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim()
  const match = trimmed.match(/^\/([^\s/]+)([\s\S]*)$/)
  if (!match) return null

  const trailingText = match[2]?.trim()
  return {
    name: match[1]!,
    trailingText: trailingText && trailingText.length > 0 ? trailingText : undefined,
  }
}

/** Extract the slash-command name being typed on a line, e.g. `/foo bar` → `foo`. */
export function extractSlashCommandName(line: string): string | null {
  const match = line.match(/^\/(\S*)/)
  return match ? (match[1] ?? '') : null
}

function formatMissingCommandError(commandName: string, candidatePaths: string[]): string {
  return `Slash command "/${commandName}" not found. Looked in: ${candidatePaths.join(', ')}.`
}

function isBuiltinCommand(name: string): name is BuiltinCommandName {
  return BUILTIN_COMMANDS.includes(name as BuiltinCommandName)
}

async function readCommandsDir(
  commandsDir: string,
  source: 'project' | 'global',
): Promise<AvailableSlashCommand[]> {
  try {
    const entries = await readdir(commandsDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => ({
        name: entry.name.slice(0, -3),
        source,
        path: path.join(commandsDir, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return []
    throw new SlashCommandError(
      `Failed to read slash commands from ${commandsDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

export async function listAvailableSlashCommands({
  projectPath,
  homeDir = os.homedir(),
}: Omit<ExpandSlashCommandOptions, 'input'>): Promise<AvailableSlashCommand[]> {
  const projectCommandsDir = getProjectCommandsDir(projectPath)
  const globalCommandsDir = getGlobalCommandsDir(homeDir)
  const [projectCommands, globalCommands] = await Promise.all([
    readCommandsDir(projectCommandsDir, 'project'),
    readCommandsDir(globalCommandsDir, 'global'),
  ])

  const merged = new Map<string, AvailableSlashCommand>()
  for (const builtinName of BUILTIN_COMMANDS) {
    mergeCommand(merged, {
      name: builtinName,
      source: 'builtin',
    })
  }
  for (const command of globalCommands) {
    mergeCommand(merged, command)
  }
  for (const command of projectCommands) {
    mergeCommand(merged, command)
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function describeCommand(command: AvailableSlashCommand): string {
  if (command.source === 'builtin') return `- /${command.name} (built-in)`

  const shadowed =
    command.shadowedSources && command.shadowedSources.length > 0
      ? `, overrides ${command.shadowedSources.join(', ')}`
      : ''
  return `- /${command.name} (${command.source}${shadowed})`
}

function formatCommandDirectories(projectPath: string, homeDir: string): string[] {
  return [
    'Command directories:',
    `- project: ${getProjectCommandsDir(projectPath)}`,
    `- global: ${getGlobalCommandsDir(homeDir)}`,
  ]
}

async function buildHelpAnswer(projectPath: string, homeDir: string): Promise<string> {
  const commands = await listAvailableSlashCommands({ projectPath, homeDir })

  return [
    'Slash commands',
    '',
    'Type `/name` in the prompt and press Enter to expand a Markdown template.',
    'If you add extra text after the command, Orb appends it after a blank line.',
    'Project commands win over global commands when names collide.',
    '',
    'Built-ins:',
    '- `/help` shows this guide.',
    '- `/commands` lists every available command.',
    '',
    ...formatCommandDirectories(projectPath, homeDir),
    '',
    'Currently available:',
    ...commands.map(describeCommand),
  ].join('\n')
}

async function buildCommandsAnswer(projectPath: string, homeDir: string): Promise<string> {
  const commands = await listAvailableSlashCommands({ projectPath, homeDir })

  return [
    'Available slash commands',
    '',
    ...commands.map(describeCommand),
    '',
    ...formatCommandDirectories(projectPath, homeDir),
  ].join('\n')
}

export async function expandSlashCommandInput({
  input,
  projectPath,
  homeDir = os.homedir(),
}: ExpandSlashCommandOptions): Promise<SlashCommandResolution> {
  const trimmedInput = input.trim()
  const parsed = parseSlashCommand(trimmedInput)
  if (!parsed) {
    return { kind: 'prompt', prompt: trimmedInput }
  }

  const candidatePaths = [
    getCommandPath(getProjectCommandsDir(projectPath), parsed.name),
    getCommandPath(getGlobalCommandsDir(homeDir), parsed.name),
  ]

  for (const candidatePath of candidatePaths) {
    try {
      const template = (await readFile(candidatePath, 'utf8')).trim()
      if (template.length === 0) {
        throw new SlashCommandError(`Slash command "/${parsed.name}" is empty: ${candidatePath}`)
      }

      return {
        kind: 'prompt',
        prompt: parsed.trailingText ? `${template}\n\n${parsed.trailingText}` : template,
        commandName: parsed.name,
        sourcePath: candidatePath,
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      if (error instanceof SlashCommandError) throw error
      throw new SlashCommandError(
        `Failed to read slash command "/${parsed.name}" from ${candidatePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  if (isBuiltinCommand(parsed.name)) {
    const answer =
      parsed.name === 'help'
        ? await buildHelpAnswer(projectPath, homeDir)
        : await buildCommandsAnswer(projectPath, homeDir)
    return {
      kind: 'builtin',
      commandName: parsed.name,
      answer,
    }
  }

  throw new SlashCommandError(formatMissingCommandError(parsed.name, candidatePaths))
}
