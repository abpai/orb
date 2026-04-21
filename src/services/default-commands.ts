import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { getGlobalCommandsDir } from './commands'

const BUNDLED_COMMANDS_DIR = path.join(import.meta.dir, '..', '..', 'commands')

export interface DefaultCommand {
  name: string
  sourcePath: string
}

export interface InstallDefaultCommandsOptions {
  targetDir?: string
  sourceDir?: string
  homeDir?: string
}

export interface InstallDefaultCommandsResult {
  targetDir: string
  installed: string[]
  skipped: string[]
}

export async function listBundledDefaultCommands(
  sourceDir = BUNDLED_COMMANDS_DIR,
): Promise<DefaultCommand[]> {
  try {
    const entries = await readdir(sourceDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => ({
        name: entry.name.slice(0, -3),
        sourcePath: path.join(sourceDir, entry.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function installDefaultCommands(
  options: InstallDefaultCommandsOptions = {},
): Promise<InstallDefaultCommandsResult> {
  const targetDir = options.targetDir ?? getGlobalCommandsDir(options.homeDir)
  const defaults = await listBundledDefaultCommands(options.sourceDir)

  if (defaults.length === 0) {
    return { targetDir, installed: [], skipped: [] }
  }

  await mkdir(targetDir, { recursive: true })

  const installed: string[] = []
  const skipped: string[] = []

  for (const command of defaults) {
    const destination = path.join(targetDir, `${command.name}.md`)
    try {
      await copyFile(command.sourcePath, destination, fsConstants.COPYFILE_EXCL)
      installed.push(command.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        skipped.push(command.name)
        continue
      }
      throw error
    }
  }

  return { targetDir, installed, skipped }
}
