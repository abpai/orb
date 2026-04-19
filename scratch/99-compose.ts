/**
 * scratch/99-compose.ts — End-to-end composition
 *
 * Traces one user-facing submission through the full stack:
 *
 *   submit(query)
 *     └─> PipelineTask.run → user-text frame
 *           └─> createPipeline([agent, tts])
 *                 └─> adapter.stream() → canonical Frame stream
 *                       └─> transport.sendOutbound(...)
 *                             └─> useConversation.handleFrame → liveTurn
 *                                   └─> handleRunComplete → saveSession
 *
 * This is the critical path — what actually happens when a user types a
 * message in the real app. The agent + tts processors are mocked to emit
 * deterministic frames; everything else (PipelineTask, transport,
 * useConversation, session persistence) is real.
 *
 * ENTRY: src/ui/App.tsx:36                    App (composition root)
 *        src/ui/hooks/usePipeline.ts:25       usePipeline()
 *        src/ui/hooks/useConversation.ts:24   useConversation()
 *
 * Run:
 *   bun run scratch/99-compose.ts
 */
import { mock } from 'bun:test'
import React from 'react'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { render } from 'ink-testing-library'
import { createFrame, type Frame } from '../src/pipeline/frames'
import type { TaskState } from '../src/pipeline/task'
import { getSessionPath, loadSession } from '../src/services/session'
import { DEFAULT_CONFIG } from '../src/types'

mock.module('../src/pipeline/processors/agent', () => ({
  createAgentProcessor: () =>
    async function* (upstream: AsyncIterable<Frame>): AsyncGenerator<Frame> {
      for await (const frame of upstream) {
        if (frame.kind !== 'user-text') {
          yield frame
          continue
        }
        yield createFrame('agent-text-delta', {
          delta: 'Orb ',
          accumulatedText: 'Orb ',
        })
        yield createFrame('tool-call-start', {
          toolCall: {
            id: 'call-1',
            index: 0,
            name: 'readFile',
            input: { path: 'ARCHITECTURE.md' },
            status: 'running',
          },
        })
        yield createFrame('tool-call-result', {
          toolIndex: 0,
          result: '# Architecture',
          status: 'complete',
        })
        yield createFrame('agent-text-delta', {
          delta: 'is a frame-based runtime.',
          accumulatedText: 'Orb is a frame-based runtime.',
        })
        yield createFrame('agent-text-complete', {
          text: 'Orb is a frame-based runtime.',
          session: { provider: 'anthropic', sessionId: 'compose-session-1' },
        })
      }
    },
}))

mock.module('../src/pipeline/processors/tts', () => ({
  createTTSProcessor:
    () =>
    async function* (upstream: AsyncIterable<Frame>): AsyncGenerator<Frame> {
      for await (const frame of upstream) yield frame
    },
}))

const { useConversation } = await import('../src/ui/hooks/useConversation')
const { usePipeline } = await import('../src/ui/hooks/usePipeline')

const root = await mkdtemp(path.join(tmpdir(), 'orb-scratch-compose-'))
const projectPath = path.join(root, 'project')
await mkdir(projectPath, { recursive: true })

const harnessConfig = { ...DEFAULT_CONFIG, projectPath, ttsEnabled: false }

const outbound: Frame['kind'][] = []
const states: TaskState[] = []
let submitRef: ((query: string) => Promise<void>) | null = null
let conversationRef: ReturnType<typeof useConversation> | null = null

function Harness() {
  const conversation = useConversation({
    config: harnessConfig,
    initialSession: null,
    taskState: 'idle',
  })
  const { submit } = usePipeline({
    config: harnessConfig,
    activeModel: conversation.activeModel,
    initialModel: conversation.initialModel,
    initialSession: conversation.initialAgentSession,
    onFrame: (frame) => {
      outbound.push(frame.kind)
      conversation.handleFrame(frame)
    },
    onRunComplete: conversation.handleRunComplete,
    onStateChange: (next) => states.push(next),
    startEntry: conversation.startEntry,
  })

  submitRef = submit
  conversationRef = conversation
  return null
}

console.log('99 · End-to-end composition\n')
console.log('Modules wired:')
console.log('  01 (config), 02 (projection), 03 (frame protocol), 05 (orchestrator), 06 (session)')
console.log()

const app = render(React.createElement(Harness))

async function waitUntil(
  predicate: () => boolean,
  { intervalMs = 10, timeoutMs = 1000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitUntil: timed out')
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

try {
  await submitRef!('what is Orb?')
  await waitUntil(() => (conversationRef?.completedTurns.length ?? 0) > 0)
  await waitUntil(() => Bun.file(getSessionPath(projectPath)).size > 0)

  console.log('Transport outbound kinds:')
  console.log(`  ${outbound.join(' → ')}`)
  console.log()

  console.log('Task state timeline:')
  console.log(`  idle → ${states.join(' → ')}`)
  console.log()

  console.log('Archived turn:')
  const turn = conversationRef!.completedTurns[0]
  console.log(`  question   : ${turn?.question}`)
  console.log(`  answer     : ${turn?.answer}`)
  console.log(`  tool calls : ${turn?.toolCalls.length}`)
  console.log(`    [${turn?.toolCalls.map((call) => `${call.name}:${call.status}`).join(', ')}]`)
  console.log()

  const saved = await loadSession(projectPath)
  console.log('Persisted session:')
  console.log(`  path       : ${getSessionPath(projectPath)}`)
  console.log(`  provider   : ${saved?.llmProvider}`)
  console.log(`  model      : ${saved?.llmModel}`)
  console.log(`  agent ses  : ${JSON.stringify(saved?.agentSession)}`)
  console.log(`  history    : ${saved?.history.length} turn(s)`)
} finally {
  app.unmount()
  await rm(getSessionPath(projectPath), { force: true })
  await rm(root, { recursive: true, force: true })
  mock.restore()
}

console.log('\nTakeaway:')
console.log('  One submit() call threads the user-text frame through the pipeline,')
console.log('  normalizes provider output into canonical frames, projects them into')
console.log('  live UI state, and persists the turn — each step lives in its own module.')
