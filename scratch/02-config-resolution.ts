/**
 * scratch/02-config-resolution.ts — CLI Config Resolution
 *
 * Proves:
 *   1. How parseCliArgs() resolves aliases, provider:model syntax, and explicit flags
 *   2. How run() applies OpenAI streaming defaults before rendering the app
 *
 * Run:
 *   bun run scratch/02-config-resolution.ts
 */
import { mock } from 'bun:test'
import { parseCliArgs } from '../src/config'

type CapturedRun = {
  args: string[]
  llmProvider: string
  llmModel: string
  ttsBufferSentences: number
  ttsMinChunkLength: number
  ttsMaxWaitMs: number
  ttsGraceWindowMs: number
  ttsClauseBoundaries: boolean
}

const cliCases: Array<{ label: string; args: string[] }> = [
  { label: '(bare defaults)', args: [] },
  { label: '--provider=claude', args: ['--provider=claude'] },
  { label: '--provider=gpt', args: ['--provider=gpt'] },
  { label: '--model=openai:gpt-4o', args: ['--model=openai:gpt-4o'] },
  { label: '--provider=openai --model=opus', args: ['--provider=openai', '--model=opus'] },
  { label: '--tts-mode=server', args: ['--tts-mode=server'] },
  {
    label: '--tts-server-url=http://localhost:9999',
    args: ['--tts-server-url=http://localhost:9999'],
  },
  {
    label: '--tts-clause-boundaries',
    args: ['--tts-clause-boundaries'],
  },
] as const

async function captureRunConfig(args: string[]): Promise<CapturedRun> {
  let captured: CapturedRun | null = null

  mock.restore()
  mock.module('ink', () => ({
    render: (node: { props?: { config?: CapturedRun } }) => {
      captured = node.props?.config ?? null
      return { unmount() {} }
    },
  }))
  mock.module('../src/ui/App', () => ({
    App: () => null,
  }))
  mock.module('../src/services/session', () => ({
    loadSession: async () => null,
  }))

  const { run } = await import('../src/index')
  const originalInfo = console.info

  try {
    console.info = () => {}
    await run(args)
  } finally {
    console.info = originalInfo
    mock.restore()
  }

  if (!captured) {
    throw new Error(`Failed to capture App config for args: ${JSON.stringify(args)}`)
  }

  return { args, ...captured }
}

console.log('╭─────────────────────────────────────────╮')
console.log('│  02 · CLI Config Resolution              │')
console.log('╰─────────────────────────────────────────╯\n')

console.log('─── parseCliArgs() ───\n')
console.log(
  '  ┌────────────────────────────────────────────┬────────────┬──────────────────────────────┬───────────────────────┐',
)
console.log(
  '  │ Input                                      │ Provider   │ Model                        │ Notable               │',
)
console.log(
  '  ├────────────────────────────────────────────┼────────────┼──────────────────────────────┼───────────────────────┤',
)

for (const cliCase of cliCases) {
  const { config } = parseCliArgs(cliCase.args)
  let notable = ''
  if (cliCase.label.includes('claude')) notable = 'alias'
  if (cliCase.label.includes('provider=gpt')) notable = notable ? `${notable}, alias` : 'alias'
  if (cliCase.label.includes('openai:gpt-4o')) notable = 'provider:model'
  if (cliCase.label.includes('openai --model=opus')) notable = 'cross-provider fallback'
  if (cliCase.label.includes('server')) notable = notable ? `${notable}, server→serve` : 'server→serve'
  if (cliCase.label.includes('tts-clause-boundaries')) notable = 'explicit flags'
  if (cliCase.label.includes('9999')) notable = 'serve forced'

  console.log(
    `  │ ${cliCase.label.padEnd(42)} │ ${config.llmProvider.padEnd(10)} │ ${config.llmModel.padEnd(28)} │ ${notable.padEnd(21)} │`,
  )
}

console.log(
  '  └────────────────────────────────────────────┴────────────┴──────────────────────────────┴───────────────────────┘',
)

console.log('\n─── ExplicitFlags from parseCliArgs() ───\n')

const explicitArgs = ['--provider=openai', '--tts-max-wait-ms=250', '--tts-clause-boundaries']
const { explicit } = parseCliArgs(explicitArgs)
console.log(`  Args: ${JSON.stringify(explicitArgs)}`)
for (const [key, value] of Object.entries(explicit)) {
  console.log(`  ${key.padEnd(20)} → ${value}`)
}

console.log('\n─── run() Captured App Config ───')
console.log('  These rows go through the real run() path in src/index.ts, not just parseCliArgs().\n')

const runCases = [
  { label: 'anthropic defaults', args: ['--provider=anthropic'] },
  { label: 'openai defaults', args: ['--provider=openai'] },
  {
    label: 'openai with explicit max wait',
    args: ['--provider=openai', '--tts-max-wait-ms=250'],
  },
] as const

for (const runCase of runCases) {
  const captured = await captureRunConfig(runCase.args)
  console.log(`  ${runCase.label}:`)
  console.log(`    provider             : ${captured.llmProvider}`)
  console.log(`    model                : ${captured.llmModel}`)
  console.log(`    ttsBufferSentences   : ${captured.ttsBufferSentences}`)
  console.log(`    ttsMinChunkLength    : ${captured.ttsMinChunkLength}`)
  console.log(`    ttsMaxWaitMs         : ${captured.ttsMaxWaitMs}`)
  console.log(`    ttsGraceWindowMs     : ${captured.ttsGraceWindowMs}`)
  console.log(`    ttsClauseBoundaries  : ${captured.ttsClauseBoundaries}`)
  console.log()
}

console.log('  OpenAI defaults only apply when the resolved provider is openai,')
console.log('  streaming TTS is enabled, and the individual knobs were not explicitly set.')
