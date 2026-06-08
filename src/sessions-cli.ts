import React from 'react'
import { render } from 'ink'

import {
  SessionPicker,
  formatProviderLabel,
  formatRelativeTime,
  pluralizeTurns,
  truncate,
} from './ui/components/SessionPicker'
import { listSessions, type SessionSummary } from './services/session'
import { abbreviateHome } from './services/orb-paths'
import { buildResumeArgs, relaunchOrb } from './services/relaunch'

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

function formatResumeCommand(session: SessionSummary): string {
  return `orb ${shellQuote(session.projectPath)} --resume ${shellQuote(session.id)}`
}

/** Plain, non-interactive listing — used when stdout is piped or not a TTY. */
export function formatSessionList(sessions: SessionSummary[]): string {
  if (sessions.length === 0) return 'No saved sessions yet.'

  const lines = sessions.map((session) => {
    const provider = formatProviderLabel(session.llmProvider)
    const title = truncate(session.preview || '(no messages yet)', 72)
    return [
      title,
      `  ${abbreviateHome(session.projectPath)} · ${provider} · ${formatRelativeTime(session.lastModified)} · ${pluralizeTurns(session.turnCount)}`,
      `  resume: ${formatResumeCommand(session)}`,
    ].join('\n')
  })

  return [`Saved sessions (${sessions.length}):`, '', ...lines].join('\n')
}

export async function runSessionsCommand(_args: string[]): Promise<void> {
  const sessions = await listSessions(undefined, process.cwd())

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
