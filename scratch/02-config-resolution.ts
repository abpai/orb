/**
 * scratch/02-config-resolution.ts — Conversation Projection
 *
 * Shows how useConversation() projects outbound frames into:
 *   liveTurn + completedTurns + ttsError + persisted session state
 *
 * ENTRY: src/ui/hooks/useConversation.ts:24 useConversation()
 *
 * Run:
 *   bun run scratch/02-config-resolution.ts
 */
import React from 'react'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { render } from 'ink-testing-library'
import { getSessionPath, loadSession } from '../src/services/session'
import type { RunResult } from '../src/pipeline/task'
import type { OutboundFrame } from '../src/pipeline/transports/types'
import { DEFAULT_CONFIG } from '../src/types'
import { useConversation } from '../src/ui/hooks/useConversation'

function makeRunResult(entryId: string, overrides?: Partial<RunResult>): RunResult {
  return { entryId, text: '', cancelled: false, ...overrides }
}

let frameId = 0
function frame(partial: Record<string, unknown>): OutboundFrame {
  return { id: ++frameId, timestamp: Date.now(), ...partial } as OutboundFrame
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const root = await mkdtemp(path.join(tmpdir(), 'orb-scratch-conversation-'))
const projectPath = path.join(root, 'project')
await mkdir(projectPath, { recursive: true })

let controls!: ReturnType<typeof useConversation>

function Harness() {
  controls = useConversation({
    config: { ...DEFAULT_CONFIG, projectPath },
    initialSession: null,
    taskState: 'idle',
  })
  return null
}

console.log('02 · Conversation Projection\n')
console.log('Primitive:')
console.log('  outbound frames -> UI conversation state\n')

const app = render(React.createElement(Harness))

try {
  const pending = controls.startEntry('Explain the architecture')
  await flush()

  console.log('After startEntry():')
  console.log(`  live question : ${controls.liveTurn?.question}`)
  console.log(`  completed     : ${controls.completedTurns.length}`)
  console.log()

  controls.handleFrame(
    frame({
      kind: 'agent-text-delta',
      delta: 'Orb is a frame-based ',
      accumulatedText: 'Orb is a frame-based ',
    }),
  )
  controls.handleFrame(
    frame({
      kind: 'tool-call-start',
      toolCall: {
        id: 'tool-1',
        index: 0,
        name: 'Read',
        input: { file_path: 'ARCHITECTURE.md' },
        status: 'running',
      },
    }),
  )
  controls.handleFrame(
    frame({
      kind: 'tool-call-result',
      toolIndex: 0,
      result: 'Architecture file loaded',
      status: 'complete',
    }),
  )
  controls.handleFrame(
    frame({
      kind: 'agent-text-complete',
      text: 'Orb is a frame-based terminal app with provider adapters and TTS.',
    }),
  )
  await flush()

  console.log('After outbound frames:')
  console.log(`  live answer   : ${controls.liveTurn?.answer}`)
  console.log(`  tool calls    : ${controls.liveTurn?.toolCalls.length}`)
  console.log(`  tts error     : ${controls.ttsError ? controls.ttsError.message : '(none)'}`)
  console.log()

  controls.handleRunComplete(
    makeRunResult(pending!.entryId, {
      session: { provider: 'anthropic', sessionId: 'claude-session-1' },
    }),
  )
  await new Promise((resolve) => setTimeout(resolve, 50))

  console.log('After handleRunComplete():')
  console.log(`  live turn     : ${controls.liveTurn === null ? 'null' : 'present'}`)
  console.log(`  completed     : ${controls.completedTurns.length}`)
  console.log(`  archived text : ${controls.completedTurns[0]?.answer}`)
  console.log()

  const saved = await loadSession(projectPath)
  console.log('Persisted session snapshot:')
  console.log(`  provider      : ${saved?.llmProvider}`)
  console.log(`  model         : ${saved?.llmModel}`)
  console.log(`  history count : ${saved?.history.length}`)
  console.log(`  session path  : ${getSessionPath(projectPath)}`)
} finally {
  app.unmount()
  await rm(getSessionPath(projectPath), { force: true })
  await rm(root, { recursive: true, force: true })
}

console.log('\nTakeaway:')
console.log('  The UI never talks to provider SDKs directly.')
console.log('  It only knows how to project canonical outbound frames into history.')
