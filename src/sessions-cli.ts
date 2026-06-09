import React from 'react'
import { render } from 'ink'

import {
  SessionPicker,
  formatProviderLabel,
  formatRelativeTime,
  formatSourceTag,
  pluralizeTurns,
  truncate,
} from './ui/components/SessionPicker'
import { listSessions, type SessionSummary } from './services/session'
import { listAllSessions } from './services/external-sessions'
import { abbreviateHome } from './services/orb-paths'
import { buildResumeArgsForSession, relaunchOrb } from './services/relaunch'

const CODEX_CAPPED_NOTE =
  'Codex scan stopped early — some older Codex sessions for this project may be hidden.'

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

function formatResumeCommand(session: SessionSummary): string {
  return `orb ${buildResumeArgsForSession(session).map(shellQuote).join(' ')}`
}

/** Plain, non-interactive listing — used when stdout is piped or not a TTY. */
export function formatSessionList(
  sessions: SessionSummary[],
  { capped = false }: { capped?: boolean } = {},
): string {
  if (sessions.length === 0) {
    // A capped scan may have hidden matching sessions, so say so even when the
    // visible list is empty rather than implying there are none.
    return capped ? `No saved sessions yet.\n\n${CODEX_CAPPED_NOTE}` : 'No saved sessions yet.'
  }

  const lines = sessions.map((session) => {
    const provider = formatProviderLabel(session.llmProvider)
    const title = truncate(session.preview || '(no messages yet)', 72)
    return [
      title,
      `  ${formatSourceTag(session.source)} · ${abbreviateHome(session.projectPath)} · ${provider} · ${formatRelativeTime(session.lastModified)} · ${pluralizeTurns(session.turnCount)}`,
      `  resume: ${formatResumeCommand(session)}`,
    ].join('\n')
  })

  const header = `Saved sessions (${sessions.length}):`
  const footer = capped ? ['', CODEX_CAPPED_NOTE] : []
  return [header, '', ...lines, ...footer].join('\n')
}

/** Short usage for `orb sessions --help`. Cyan header gated on an interactive TTY. */
export function formatSessionsHelp(): string {
  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
  const heading = (s: string) => (color ? `\x1b[1m\x1b[36m${s}\x1b[0m` : s)
  return [
    `${heading('orb sessions')} — browse and resume saved conversations`,
    '',
    `${heading('Usage:')} orb sessions [--all]`,
    '  Interactive picker in a TTY; plain list when piped.',
    '  Pick a session to relaunch orb with the right resume flag.',
    '',
    `${heading('Options:')}`,
    '  --all    Also include this project’s Claude Code and Codex sessions',
  ].join('\n')
}

export async function runSessionsCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(formatSessionsHelp())
    return
  }

  // `--all` also surfaces this project's Claude Code and Codex sessions, not
  // just orb's own saved conversations.
  const includeExternal = args.includes('--all')
  const cwd = process.cwd()

  const { sessions, capped } = includeExternal
    ? await listAllSessions(cwd).then((r) => ({ sessions: r.sessions, capped: r.codexCapped }))
    : { sessions: await listSessions(undefined, cwd), capped: false }

  if (!process.stdout.isTTY || sessions.length === 0) {
    console.log(formatSessionList(sessions, { capped }))
    return
  }

  const instance = render(
    React.createElement(SessionPicker, {
      sessions,
      note: capped ? CODEX_CAPPED_NOTE : undefined,
      onSelect: (session: SessionSummary) =>
        void relaunchOrb(buildResumeArgsForSession(session), () => instance.unmount()),
      onCancel: () => instance.unmount(),
    }),
    { patchConsole: true, concurrent: true },
  )

  await instance.waitUntilExit()
}
