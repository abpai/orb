import type { Command } from 'commander'
import packageJson from '../../package.json' with { type: 'json' }

/**
 * Long-flag names shown under "Common options". Everything else registered in
 * createProgram falls to "Advanced options" automatically, so a newly added flag
 * lands at the bottom rather than vanishing from help.
 */
const COMMON_OPTION_FLAGS = new Set([
  '--provider',
  '--model',
  '--voice',
  '--new',
  '--resume',
  '--skip-intro',
  '--no-tts',
])

const HELP_EXAMPLES = [
  'orb                              Current directory, auto provider',
  'orb /path/to/project             Open a specific project',
  'orb --voice=marius',
  'orb --provider=openai --model=gpt-5.5',
  'orb --model=openai:gpt-5.5',
  'orb sessions                     Resume a past conversation',
  'orb sessions --all               Include Claude Code / Codex sessions',
]

const HELP_CONTROLS =
  'Enter send · Ctrl+J / Alt+↵ newline · Cmd+V paste · Shift+Tab cycle models · Ctrl+C exit'

interface OptionRow {
  flags: string
  description: string
}

/** Cyan-bold section headers, gated on an interactive TTY without NO_COLOR. */
function helpStyler(): { heading: (s: string) => string; dim: (s: string) => string } {
  const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
  if (!enabled) return { heading: (s) => s, dim: (s) => s }
  return {
    heading: (s) => `\x1b[1m\x1b[36m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
  }
}

function wrapWords(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (!current) current = word
    else if (current.length + 1 + word.length <= width) current += ` ${word}`
    else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Two-column option table: padded flags on the left, wrapped descriptions right. */
function formatOptionRows(rows: OptionRow[], width: number): string[] {
  const indent = '  '
  const gap = 2
  const flagWidth = Math.min(
    32,
    rows.reduce((max, row) => Math.max(max, row.flags.length), 0),
  )
  const descColumn = indent.length + flagWidth + gap
  const descWidth = Math.max(24, width - descColumn)

  const lines: string[] = []
  for (const row of rows) {
    const descLines = row.description ? wrapWords(row.description, descWidth) : ['']
    if (row.flags.length > flagWidth) {
      lines.push(`${indent}${row.flags}`)
      if (row.description) for (const d of descLines) lines.push(`${' '.repeat(descColumn)}${d}`)
    } else {
      const pad = ' '.repeat(flagWidth - row.flags.length + gap)
      const [first = '', ...rest] = descLines
      lines.push(`${indent}${row.flags}${pad}${first}`.trimEnd())
      for (const d of rest) lines.push(`${' '.repeat(descColumn)}${d}`)
    }
  }
  return lines
}

/**
 * Render the full `orb --help` body. Option lines are derived from the live
 * program definitions (so flags/descriptions never drift); only the Commands
 * block and the Common/Advanced partition are curated. `setup` and `sessions`
 * are dispatched manually in index.ts (not Commander subcommands), so they are
 * listed here by hand.
 */
export function buildHelpText(program: Command): string {
  const version = packageJson.version
  const width = process.stdout.columns || 80
  const { heading, dim } = helpStyler()

  const visible = program.options.filter(
    (opt) => !opt.hidden && opt.long !== '--help' && opt.long !== '--version',
  )
  const toRow = (opt: (typeof visible)[number]): OptionRow => ({
    flags: opt.flags,
    description: opt.description,
  })
  const commonRows = visible.filter((opt) => COMMON_OPTION_FLAGS.has(opt.long ?? '')).map(toRow)
  const advancedRows = [
    ...visible.filter((opt) => !COMMON_OPTION_FLAGS.has(opt.long ?? '')).map(toRow),
    { flags: '-V, --version', description: 'Print version' },
    { flags: '-h, --help', description: 'Show this help' },
  ]

  const out: string[] = []
  out.push(`orb — ${program.description()}  v${version}`)
  out.push('')
  out.push(`${heading('Usage:')} orb [projectPath] [options]`)
  out.push('       orb <command>')
  out.push('')
  out.push(heading('Commands:'))
  out.push(
    ...formatOptionRows(
      [
        {
          flags: 'orb [projectPath]',
          description: 'Start orb in a project (default: current dir)',
        },
        { flags: 'orb setup', description: 'Create or update ~/.orb/config.toml' },
        {
          flags: 'orb sessions',
          description: 'Browse and resume saved sessions (--all adds Claude/Codex)',
        },
      ],
      width,
    ),
  )
  out.push('')
  out.push(heading('Common options:'))
  out.push(...formatOptionRows(commonRows, width))
  out.push('')
  out.push(heading('Examples:'))
  out.push(...HELP_EXAMPLES.map((line) => `  ${line}`))
  out.push('')
  out.push(heading('Controls (in-app):'))
  out.push(`  ${HELP_CONTROLS}`)
  out.push('')
  out.push(heading('Advanced options:'))
  out.push(...formatOptionRows(advancedRows, width))
  out.push('')
  out.push(
    dim(
      'Auto provider (when --provider/--model omitted): 1) Codex/ChatGPT  2) Claude SDK  3) GEMINI key  4) ANTHROPIC key',
    ),
  )
  out.push(dim('Defaults live in ~/.orb/config.toml · CLI flags override per run · docs: README'))

  return `${out.join('\n')}\n`
}
