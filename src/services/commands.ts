import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const ORB_DIR = '.orb'
const COMMANDS_DIR = 'commands'

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
  prompt: string
  commandName?: string
  sourcePath?: string
}

export interface ExpandSlashCommandOptions {
  input: string
  projectPath: string
  homeDir?: string
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

function formatMissingCommandError(commandName: string, candidatePaths: string[]): string {
  return `Slash command "/${commandName}" not found. Looked in: ${candidatePaths.join(', ')}.`
}

export async function expandSlashCommandInput({
  input,
  projectPath,
  homeDir = os.homedir(),
}: ExpandSlashCommandOptions): Promise<ExpandedPrompt> {
  const trimmedInput = input.trim()
  const parsed = parseSlashCommand(trimmedInput)
  if (!parsed) {
    return { prompt: trimmedInput }
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

  throw new SlashCommandError(formatMissingCommandError(parsed.name, candidatePaths))
}
