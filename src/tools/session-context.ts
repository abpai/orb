#!/usr/bin/env bun
import os from 'node:os'

import {
  formatSessionContext,
  loadSessionContext,
  parsePositiveInteger,
  parseSessionReference,
  type SessionContextFormat,
  type SessionContextProvider,
} from '../services/session-context'

interface CliOptions {
  input?: string
  provider?: SessionContextProvider
  id?: string
  cwd?: string
  tail: number
  includeTools: boolean
  maxEntryChars: number
  format: SessionContextFormat
  homeDir: string
}

function help(): string {
  return `Usage:
  bun src/tools/session-context.ts --input '<provider/session/cwd block>' [options]
  bun src/tools/session-context.ts --provider claude --id <id> --cwd <path> [options]
  cat block.txt | bun src/tools/session-context.ts [options]

Options:
  --input <text>             Pasted session block containing provider, id, and cwd
  --provider <claude|codex>  Provider when not using --input
  --id <id>                  Claude session id or Codex thread id
  --cwd <path>               Project working directory for the session
  --tail <count>             Normalized entries to print (default: 30)
  --max-entry-chars <count>  Truncate each entry after this many chars (default: 1200)
  --no-tools                 Hide tool calls/results
  --json                     Print structured JSON instead of Markdown
  --home <path>              Override home directory for tests or copied state
  -h, --help                 Show this help
`
}

function readOption(argv: string[], index: number, name: string): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  return value
}

function parseProvider(value: string): SessionContextProvider {
  const normalized = value.toLowerCase()
  if (normalized === 'claude' || normalized === 'anthropic') return 'claude'
  if (normalized === 'codex' || normalized === 'openai') return 'codex'
  throw new Error('--provider must be claude or codex.')
}

function splitOption(arg: string): [string, string | undefined] {
  const index = arg.indexOf('=')
  if (index === -1) return [arg, undefined]
  return [arg.slice(0, index), arg.slice(index + 1)]
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    tail: 30,
    includeTools: true,
    maxEntryChars: 1200,
    format: 'markdown',
    homeDir: os.homedir(),
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const [name, inlineValue] = splitOption(arg)

    switch (name) {
      case '--input':
        {
          const value = inlineValue ?? readOption(argv, i, arg)
          options.input = value
        }
        if (inlineValue === undefined) i++
        break
      case '--provider':
        options.provider = parseProvider(inlineValue ?? readOption(argv, i, arg))
        if (inlineValue === undefined) i++
        break
      case '--id':
        options.id = inlineValue ?? readOption(argv, i, arg)
        if (inlineValue === undefined) i++
        break
      case '--cwd':
        options.cwd = inlineValue ?? readOption(argv, i, arg)
        if (inlineValue === undefined) i++
        break
      case '--tail':
        options.tail = parsePositiveInteger(inlineValue ?? readOption(argv, i, arg), '--tail')
        if (inlineValue === undefined) i++
        break
      case '--max-entry-chars':
        options.maxEntryChars = parsePositiveInteger(
          inlineValue ?? readOption(argv, i, arg),
          '--max-entry-chars',
        )
        if (inlineValue === undefined) i++
        break
      case '--home':
        options.homeDir = inlineValue ?? readOption(argv, i, arg)
        if (inlineValue === undefined) i++
        break
      case '--json':
        options.format = 'json'
        break
      case '--no-tools':
        options.includeTools = false
        break
      case '-h':
      case '--help':
        throw Object.assign(new Error(help()), { exitCode: 0 })
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

async function readStdinIfAvailable(): Promise<string> {
  if (process.stdin.isTTY) return ''
  return await Bun.stdin.text()
}

export async function runSessionContextCli(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv)
  const input = options.input ?? (await readStdinIfAvailable())
  const reference = parseSessionReference(input, {
    provider: options.provider,
    id: options.id,
    cwd: options.cwd,
  })
  const context = await loadSessionContext(reference, {
    homeDir: options.homeDir,
    tail: options.tail,
    includeTools: options.includeTools,
    maxEntryChars: options.maxEntryChars,
  })
  process.stdout.write(formatSessionContext(context, options.format))
}

if (import.meta.main) {
  runSessionContextCli().catch((err) => {
    const code = typeof err?.exitCode === 'number' ? err.exitCode : 1
    const message = err instanceof Error ? err.message : String(err)
    ;(code === 0 ? process.stdout : process.stderr).write(`${message}\n`)
    process.exit(code)
  })
}
