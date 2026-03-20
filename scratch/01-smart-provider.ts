/**
 * scratch/01-smart-provider.ts — Provider Selection Waterfall
 *
 * Proves:
 *   1. What resolveSmartProvider() does on this machine right now
 *   2. Why token-looking auth payloads still do not count as usable OpenAI credentials
 *
 * Run:
 *   bun run scratch/01-smart-provider.ts
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { findToken, parseCodexAuthFile } from '../src/services/auth-utils'
import { resolveSmartProvider } from '../src/services/provider-defaults'
import { DEFAULT_CONFIG } from '../src/types'

function mask(value: string | undefined): string {
  if (!value) return '(not set)'
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

async function withFixtureAuthFile(
  payload: unknown,
  run: (fixturePath: string) => Promise<void>,
): Promise<void> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'orb-smart-provider-'))
  const fixturePath = join(fixtureRoot, 'auth.json')
  const previousCodexHome = Bun.env.CODEX_HOME

  try {
    await mkdir(fixtureRoot, { recursive: true })
    await Bun.write(fixturePath, JSON.stringify(payload, null, 2))
    Bun.env.CODEX_HOME = fixtureRoot
    await run(fixturePath)
  } finally {
    if (previousCodexHome === undefined) delete Bun.env.CODEX_HOME
    else Bun.env.CODEX_HOME = previousCodexHome
    await rm(fixtureRoot, { recursive: true, force: true })
  }
}

console.log('╭─────────────────────────────────────────╮')
console.log('│  01 · Smart Provider Selection Waterfall │')
console.log('╰─────────────────────────────────────────╯\n')

console.log('─── Live Environment Probe ───')
console.log(`  ANTHROPIC_API_KEY : ${mask(Bun.env.ANTHROPIC_API_KEY)}`)
console.log(`  CLAUDE_API_KEY    : ${mask(Bun.env.CLAUDE_API_KEY)}`)
console.log(`  OPENAI_API_KEY    : ${mask(Bun.env.OPENAI_API_KEY)}`)
console.log(
  `  ~/.codex/auth.json: ${existsSync(join(homedir(), '.codex', 'auth.json')) ? 'exists' : 'not found'}`,
)

console.log('\n  Running resolveSmartProvider() — the Claude OAuth probe may take up to ~3s...')
const startedAt = performance.now()
const liveResult = await resolveSmartProvider({ ...DEFAULT_CONFIG })
const liveElapsed = Math.round(performance.now() - startedAt)

console.log(
  `  result (${liveElapsed}ms): ${liveResult ? `${liveResult.provider} via ${liveResult.source}` : 'null'}`,
)

console.log('\n─── Deterministic Token Fixture Cases ───')

const fixtureCases = [
  {
    label: 'token-looking auth.json but incomplete Codex tokens',
    payload: {
      nested: { sessionToken: 'chatgpt-session-token-only' },
      tokens: { id_token: 'header.payload.signature' },
    },
  },
  {
    label: 'full Codex auth payload',
    payload: {
      last_refresh: '2026-03-12T00:00:00.000Z',
      tokens: {
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-456',
        id_token: 'header.payload.signature',
      },
    },
  },
] as const

for (const fixture of fixtureCases) {
  await withFixtureAuthFile(fixture.payload, async (fixturePath) => {
    const heuristicToken = findToken(fixture.payload)
    const parsedTokens = parseCodexAuthFile(fixture.payload)

    console.log(`\n  ${fixture.label}:`)
    console.log(`    fixture path         : ${fixturePath}`)
    console.log(`    findToken(payload)   : ${heuristicToken ? 'token present' : 'null'}`)
    console.log(`    parseCodexAuthFile   : ${parsedTokens ? 'valid access+refresh tokens' : 'null'}`)
    console.log(`    provider impact      : none (Orb now checks OPENAI_API_KEY only)`)
  })
}

console.log('\nPriority waterfall (first match wins):')
console.log('  1. Claude OAuth (Claude SDK accountInfo probe)')
console.log('  2. OPENAI_API_KEY')
console.log('  3. ANTHROPIC_API_KEY / CLAUDE_API_KEY')
