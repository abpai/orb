/**
 * scratch/01-smart-provider.ts — Startup Funnel
 *
 * Shows the real startup sequence in src/index.ts:
 *   CLI args + global config + smart-provider detection + session lookup
 *   -> one App config
 *
 * Run:
 *   bun run scratch/01-smart-provider.ts
 */
import { mock } from 'bun:test'
import type { AppConfig, SavedSession } from '../src/types'

type Scenario = {
  globalConfig?: Partial<AppConfig>
  explicit?: Record<string, boolean>
  smartProvider?: { provider: 'anthropic' | 'openai'; source: string } | null
  session?: SavedSession | null
}

let scenario: Scenario = {}
let steps: string[] = []
let capturedConfig: AppConfig | null = null
let capturedSession: SavedSession | null = null

mock.module('ink', () => ({
  render: (node: { props?: { config?: AppConfig; initialSession?: SavedSession | null } }) => {
    steps.push('render(App)')
    capturedConfig = node.props?.config ?? null
    capturedSession = node.props?.initialSession ?? null
    return { unmount() {} }
  },
}))

mock.module('../src/ui/App', () => ({
  App: () => null,
}))

mock.module('../src/services/global-config', () => ({
  loadGlobalConfig: async () => {
    steps.push('loadGlobalConfig()')
    return {
      config: {
        ...(scenario.globalConfig?.llmProvider ? { provider: scenario.globalConfig.llmProvider } : {}),
        ...(scenario.globalConfig?.llmModel ? { model: scenario.globalConfig.llmModel } : {}),
        ...(scenario.globalConfig?.skipIntro !== undefined
          ? { skipIntro: scenario.globalConfig.skipIntro }
          : {}),
      },
      explicit: scenario.explicit ?? {},
      warnings: [],
      path: '/mock/.orb/config.toml',
      exists: true,
    }
  },
  applyGlobalConfig: (base: AppConfig) => {
    steps.push('applyGlobalConfig()')
    return { ...base, ...scenario.globalConfig }
  },
}))

mock.module('../src/services/provider-defaults', () => ({
  resolveSmartProvider: async () => {
    steps.push('resolveSmartProvider()')
    return scenario.smartProvider ?? null
  },
}))

mock.module('../src/services/session', () => ({
  loadSession: async () => {
    steps.push('loadSession()')
    return scenario.session ?? null
  },
}))

mock.module('../src/setup', () => ({
  runSetupCommand: async () => {
    steps.push('runSetupCommand()')
  },
}))

const { run } = await import('../src/index')

const savedSession: SavedSession = {
  version: 2,
  projectPath: '/tmp/orb-demo',
  llmProvider: 'openai',
  llmModel: 'gpt-5.4',
  agentSession: { provider: 'openai', previousResponseId: 'resp_demo_123' },
  lastModified: '2026-03-24T00:00:00.000Z',
  history: [{ id: 'turn-1', question: 'hi', toolCalls: [], answer: 'hello', error: null }],
}

async function capture(label: string, args: string[], nextScenario: Scenario) {
  scenario = nextScenario
  steps = []
  capturedConfig = null
  capturedSession = null

  await run(args)

  if (!capturedConfig) {
    throw new Error(`Failed to capture config for scenario: ${label}`)
  }

  console.log(`Scenario: ${label}`)
  console.log(`  steps     : ${steps.join(' -> ')}`)
  console.log(`  provider  : ${capturedConfig.llmProvider}`)
  console.log(`  model     : ${capturedConfig.llmModel}`)
  console.log(`  startFresh: ${capturedConfig.startFresh}`)
  console.log(`  session   : ${capturedSession ? 'restored' : 'null'}`)
  console.log()
}

console.log('01 · Startup Funnel\n')
console.log('Primitive:')
console.log('  startup inputs -> one runtime config passed into App\n')

await capture('explicit provider skips smart detection', ['--provider=openai'], {
  session: savedSession,
})

await capture('omitted provider triggers smart detection', [], {
  smartProvider: { provider: 'anthropic', source: 'claude-oauth' },
  session: null,
})

await capture('new session skips loadSession()', ['--new', '--provider=anthropic'], {
  session: savedSession,
})

mock.restore()

console.log('Takeaway:')
console.log('  src/index.ts is a startup funnel, not business logic.')
console.log('  Its job is to collapse multiple input layers into one App config.')
