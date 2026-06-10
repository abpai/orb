import React from 'react'
import { render } from 'ink'

import {
  SessionPicker,
  formatProviderLabel,
  formatRelativeTime,
  formatSourceTag,
  pluralizeTurns,
} from './ui/components/SessionPicker'
import { collapseToSingleLine } from './ui/utils/text'
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

function formatResumeCommand(session: SessionSummary, extraArgs: string[] = []): string {
  return `orb ${buildResumeArgsForSession(session, extraArgs).map(shellQuote).join(' ')}`
}

export function parseSessionsArgs(args: string[]): {
  includeExternal: boolean
  resumeExtraArgs: string[]
} {
  const resumeExtraArgs: string[] = []
  let includeExternal = false

  for (const arg of args) {
    if (arg === '--all') {
      includeExternal = true
      continue
    }
    if (arg.startsWith('--all=')) {
      const value = arg.slice('--all='.length).trim().toLowerCase()
      includeExternal = value !== 'false' && value !== '0'
      continue
    }
    resumeExtraArgs.push(arg)
  }

  return { includeExternal, resumeExtraArgs }
}

/** Plain, non-interactive listing — used when stdout is piped or not a TTY. */
export function formatSessionList(
  sessions: SessionSummary[],
  { capped = false, resumeExtraArgs = [] }: { capped?: boolean; resumeExtraArgs?: string[] } = {},
): string {
  if (sessions.length === 0) {
    // A capped scan may have hidden matching sessions, so say so even when the
    // visible list is empty rather than implying there are none.
    return capped ? `No saved sessions yet.\n\n${CODEX_CAPPED_NOTE}` : 'No saved sessions yet.'
  }

  const lines = sessions.map((session) => {
    const provider = formatProviderLabel(session.llmProvider)
    const title = collapseToSingleLine(session.preview || '(no messages yet)', 72)
    return [
      title,
      `  ${formatSourceTag(session.source)} · ${abbreviateHome(session.projectPath)} · ${provider} · ${formatRelativeTime(session.lastModified)} · ${pluralizeTurns(session.turnCount)}`,
      `  resume: ${formatResumeCommand(session, resumeExtraArgs)}`,
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
    `${heading('Usage:')} orb sessions [--all] [orb options]`,
    '  Interactive picker in a TTY; plain list when piped.',
    '  Pick a session to relaunch orb with the right resume flag.',
    '',
    `${heading('Options:')}`,
    '  --all    Also include this project’s Claude Code and Codex sessions',
    '  Orb runtime options like --provider, --model, and --reasoning-effort are kept for the resumed session.',
  ].join('\n')
}

export async function runSessionsCommand(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(formatSessionsHelp())
    return
  }

  const { includeExternal, resumeExtraArgs } = parseSessionsArgs(args)

  // `--all` also surfaces this project's Claude Code and Codex sessions, not
  // just orb's own saved conversations.
  const cwd = process.cwd()

  const { sessions, capped } = includeExternal
    ? await listAllSessions(cwd).then((r) => ({ sessions: r.sessions, capped: r.codexCapped }))
    : { sessions: await listSessions(undefined, cwd), capped: false }

  if (!process.stdout.isTTY || sessions.length === 0) {
    console.log(formatSessionList(sessions, { capped, resumeExtraArgs }))
    return
  }

  const instance = render(
    React.createElement(SessionPicker, {
      sessions,
      note: capped ? CODEX_CAPPED_NOTE : undefined,
      onSelect: (session: SessionSummary) =>
        void relaunchOrb(buildResumeArgsForSession(session, resumeExtraArgs), () =>
          instance.unmount(),
        ),
      onCancel: () => instance.unmount(),
    }),
    { patchConsole: true, concurrent: true },
  )

  await instance.waitUntilExit()
}
