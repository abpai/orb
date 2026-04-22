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

  const results = await Promise.all(
    defaults.map(async (command): Promise<{ name: string; status: 'installed' | 'skipped' }> => {
      const destination = path.join(targetDir, `${command.name}.md`)
      try {
        await copyFile(command.sourcePath, destination, fsConstants.COPYFILE_EXCL)
        return { name: command.name, status: 'installed' }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          return { name: command.name, status: 'skipped' }
        }
        throw error
      }
    }),
  )

  const installed = results.filter((r) => r.status === 'installed').map((r) => r.name)
  const skipped = results.filter((r) => r.status === 'skipped').map((r) => r.name)

  return { targetDir, installed, skipped }
}
