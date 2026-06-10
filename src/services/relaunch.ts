import { fileURLToPath } from 'node:url'

import type { SessionSource } from '../types'
import type { SessionSummary } from './session'

/** Resolve the orb entry script so a child process re-invokes the same CLI. */
export function resolveEntryPath(): string {
  return process.argv[1] ?? fileURLToPath(new URL('../cli.ts', import.meta.url))
}

/** Build the argv that resumes a specific orb saved session. */
export function buildResumeArgs(
  projectPath: string,
  id: string,
  extraArgs: string[] = [],
): string[] {
  return [projectPath, '--resume', id, ...extraArgs]
}

/**
 * Build the argv that resumes a session by source: orb saved sessions go
 * through `--resume`, external ones through the provider handoff flags so the
 * adapter resolves them against the Claude Code / Codex stores.
 */
export function buildExternalResumeArgs(
  projectPath: string,
  source: SessionSource,
  externalId: string,
  extraArgs: string[] = [],
): string[] {
  switch (source) {
    case 'claude':
      return [projectPath, '--claude-session', externalId, ...extraArgs]
    case 'codex':
      return [projectPath, '--codex-thread', externalId, ...extraArgs]
    default:
      return buildResumeArgs(projectPath, externalId, extraArgs)
  }
}

/** Pick the right resume argv for a picker row regardless of its source. */
export function buildResumeArgsForSession(
  session: SessionSummary,
  extraArgs: string[] = [],
): string[] {
  return buildExternalResumeArgs(session.projectPath, session.source, session.id, extraArgs)
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
