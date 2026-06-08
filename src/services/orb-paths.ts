import os from 'node:os'
import path from 'node:path'

/**
 * Single owner of where orb keeps its files and how to detect a missing one.
 * The `.orb` directory name lives here only; every accessor takes an optional
 * `homeDir` so tests can point orb at a temp directory.
 */

/** The directory name orb stores data under, in $HOME and per-project. */
export const ORB_DIR_NAME = '.orb'

/** Absolute path to orb's home directory (~/.orb). */
export function orbHome(homeDir = os.homedir()): string {
  return path.join(homeDir, ORB_DIR_NAME)
}

/** ~/.orb/config.toml */
export function globalConfigPath(homeDir = os.homedir()): string {
  return path.join(orbHome(homeDir), 'config.toml')
}

/** ~/.orb/sessions */
export function sessionsDir(homeDir = os.homedir()): string {
  return path.join(orbHome(homeDir), 'sessions')
}

/** ~/.orb/models/gateway.json */
export function modelCachePath(homeDir = os.homedir()): string {
  return path.join(orbHome(homeDir), 'models', 'gateway.json')
}

/** ~/.orb/commands */
export function globalCommandsDir(homeDir = os.homedir()): string {
  return path.join(orbHome(homeDir), 'commands')
}

/** Collapse the user's home directory to `~` so paths stay readable in the UI. */
export function abbreviateHome(targetPath: string, homeDir = os.homedir()): string {
  if (!homeDir) return targetPath
  if (targetPath === homeDir) return '~'
  if (targetPath.startsWith(homeDir + path.sep)) return `~${targetPath.slice(homeDir.length)}`
  return targetPath
}

/** True when a filesystem error means "file or directory does not exist". */
export function isFileNotFoundError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ENOENT'
}
