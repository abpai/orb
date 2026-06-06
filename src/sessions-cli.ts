import React from 'react'
import { render } from 'ink'

import { SessionPicker, formatRelativeTime } from './ui/components/SessionPicker'
import { listSessions, type SessionSummary } from './services/session'
import { buildResumeArgs, relaunchOrb } from './services/relaunch'

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}

/** Plain, non-interactive listing — used when stdout is piped or not a TTY. */
export function formatSessionList(sessions: SessionSummary[]): string {
  if (sessions.length === 0) return 'No saved sessions yet.'

  const lines = sessions.map((session) => {
    const provider = session.llmProvider === 'anthropic' ? 'claude' : 'openai'
    const preview = truncate(session.preview || '(no messages yet)', 60)
    return [
      `${session.projectName}  (${provider} · ${formatRelativeTime(session.lastModified)} · ${session.turnCount} turns)`,
      `  ${preview}`,
      `  resume: orb ${session.projectPath} --resume ${session.id}`,
    ].join('\n')
  })

  return [`Saved sessions (${sessions.length}):`, '', ...lines].join('\n')
}

export async function runSessionsCommand(_args: string[]): Promise<void> {
  const sessions = await listSessions()

  if (!process.stdout.isTTY || sessions.length === 0) {
    console.log(formatSessionList(sessions))
    return
  }

  const instance = render(
    React.createElement(SessionPicker, {
      sessions,
      onSelect: (session: SessionSummary) =>
        void relaunchOrb(buildResumeArgs(session.projectPath, session.id), () =>
          instance.unmount(),
        ),
      onCancel: () => instance.unmount(),
    }),
    { patchConsole: true },
  )

  await instance.waitUntilExit()
}
