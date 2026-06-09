import os from 'node:os'

import type { AgentSession } from '../../types'
import { listSessions, type SessionSummary } from '../session'
import { listClaudeSessions, lookupClaudeMeta } from './claude'
import { listCodexSessions, lookupCodexMeta } from './codex'
import type { ExternalSessionMeta } from './types'

export type { ExternalSessionMeta, CodexListResult } from './types'
export { encodeClaudeProjectDir, claudeProjectDir, listClaudeSessions } from './claude'
export { listCodexSessions } from './codex'

/** orb + Claude Code + Codex sessions for a project, merged newest-first. */
export async function listAllSessions(
  projectPath: string,
  homeDir = os.homedir(),
): Promise<{ sessions: SessionSummary[]; codexCapped: boolean }> {
  const [orb, claude, codex] = await Promise.all([
    listSessions(homeDir, projectPath),
    listClaudeSessions(projectPath, homeDir),
    listCodexSessions(projectPath, homeDir),
  ])
  const sessions = [...orb, ...claude, ...codex.rows].sort((a, b) =>
    b.lastModified.localeCompare(a.lastModified),
  )
  return { sessions, codexCapped: codex.capped }
}

/**
 * Message count + preview for an external session being resumed, used to tell
 * the user how much hidden history the model still has. Null when the session
 * can't be located (resume still works; the banner just omits the count).
 */
export async function lookupExternalSessionMeta(
  session: AgentSession,
  projectPath: string,
  homeDir = os.homedir(),
): Promise<ExternalSessionMeta | null> {
  if (session.provider === 'anthropic') {
    return lookupClaudeMeta(session.sessionId, projectPath, homeDir)
  }
  return lookupCodexMeta(session.threadId, projectPath, homeDir)
}
