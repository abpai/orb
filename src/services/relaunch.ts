import { fileURLToPath } from 'node:url'

/** Resolve the orb entry script so a child process re-invokes the same CLI. */
export function resolveEntryPath(): string {
  return process.argv[1] ?? fileURLToPath(new URL('../cli.ts', import.meta.url))
}

/** Build the argv that resumes a specific saved session. */
export function buildResumeArgs(projectPath: string, id: string): string[] {
  return [projectPath, '--resume', id]
}

/**
 * Replace the current process with a fresh orb run. The optional `beforeSpawn`
 * hook lets callers tear down an active Ink render so the child owns the TTY.
 */
export async function relaunchOrb(args: string[], beforeSpawn?: () => void): Promise<never> {
  beforeSpawn?.()
  const child = Bun.spawn([process.execPath, resolveEntryPath(), ...args], {
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  const code = await child.exited
  process.exit(code)
}
