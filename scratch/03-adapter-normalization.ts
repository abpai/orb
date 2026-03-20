/**
 * scratch/03-adapter-normalization.ts — Adapter Normalization Seams
 *
 * Proves:
 *   1. The shared parsing/formatting helpers used by both providers
 *   2. Anthropic dropping unmatched tool_result blocks
 *   3. OpenAI synthesizing a tool-call-start when a result arrives first
 *
 * Run:
 *   bun run scratch/03-adapter-normalization.ts
 */
import { mock } from 'bun:test'
import type { Frame } from '../src/pipeline/frames'
import { DEFAULT_CONFIG } from '../src/types'
import {
  formatToolResult,
  getContentBlocks,
  isToolError,
  normalizeToolInput,
} from '../src/pipeline/adapters/utils'

async function collectFrames(source: AsyncIterable<Frame>): Promise<Frame[]> {
  const frames: Frame[] = []
  for await (const frame of source) frames.push(frame)
  return frames
}

console.log('╭─────────────────────────────────────────╮')
console.log('│  03 · Adapter Normalization Seams        │')
console.log('╰─────────────────────────────────────────╯\n')

console.log('─── Shared Helper Functions ───\n')

const normalizeCases = [
  { label: 'object', value: { command: 'ls' } },
  { label: 'json string', value: '{"path":"README.md"}' },
  { label: 'plain string', value: 'README.md' },
  { label: 'null', value: null },
] as const

for (const testCase of normalizeCases) {
  console.log(
    `  normalizeToolInput(${testCase.label.padEnd(12)}) → ${JSON.stringify(normalizeToolInput(testCase.value))}`,
  )
}

console.log()
console.log(
  `  formatToolResult(stdout/stderr) → ${JSON.stringify(formatToolResult({ stdout: 'out', stderr: 'warn' }))}`,
)
console.log(
  `  formatToolResult(content)       → ${JSON.stringify(formatToolResult({ content: 'file body' }))}`,
)
console.log(`  isToolError(exitCode=1)         → ${isToolError({ exitCode: 1 })}`)
console.log(`  isToolError(stdout only)        → ${isToolError({ stdout: 'ok' })}`)
console.log(`  getContentBlocks("hello")       → ${JSON.stringify(getContentBlocks('hello'))}`)

console.log('\n─── Anthropic Adapter: unmatched tool_result is dropped ───\n')

mock.restore()
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: () =>
    (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'anthropic-session-1' }
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Inspecting README. ' },
            { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'README.md' } },
          ],
        },
      }
      yield {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: [{ type: 'text', text: 'README contents' }],
            },
            {
              type: 'tool_result',
              tool_use_id: 'missing-tool',
              content: [{ type: 'text', text: 'orphaned result' }],
            },
          ],
        },
      }
      yield { type: 'result', subtype: 'success', result: 'Done.' }
    })(),
}))

const { createAnthropicAdapter } = await import('../src/pipeline/adapters/anthropic')
const anthropicFrames = await collectFrames(
  createAnthropicAdapter({
    appConfig: { ...DEFAULT_CONFIG, ttsEnabled: false },
    session: undefined,
    abortController: new AbortController(),
  }).stream('show me the README'),
)

const anthropicToolResults = anthropicFrames.filter((frame) => frame.kind === 'tool-call-result')
console.log('  Fixture contained 2 tool_result blocks:')
console.log('    - one matched tool_use_id="tool-1"')
console.log('    - one unmatched tool_use_id="missing-tool"')
console.log(`  Adapter emitted ${anthropicToolResults.length} tool-call-result frame(s).\n`)

for (const frame of anthropicFrames) {
  if (frame.kind === 'agent-session') {
    console.log(`    agent-session       → ${frame.session.provider}:${frame.session.provider === 'anthropic' ? frame.session.sessionId : 'n/a'}`)
  }
  if (frame.kind === 'agent-text-delta') {
    console.log(`    agent-text-delta    → ${JSON.stringify(frame.delta)}`)
  }
  if (frame.kind === 'tool-call-start') {
    console.log(
      `    tool-call-start     → ${frame.toolCall.name} ${JSON.stringify(frame.toolCall.input)}`,
    )
  }
  if (frame.kind === 'tool-call-result') {
    console.log(
      `    tool-call-result    → index=${frame.toolIndex} status=${frame.status} result=${JSON.stringify(frame.result)}`,
    )
  }
  if (frame.kind === 'agent-text-complete') {
    console.log(`    agent-text-complete → ${JSON.stringify(frame.text)}`)
  }
}

console.log('\n─── OpenAI Adapter: orphan result synthesizes tool-call-start ───\n')

mock.restore()
mock.module('bash-tool', () => ({
  createBashTool: async () => ({
    tools: {
      bash: {},
      readFile: {},
      writeFile: {},
    },
    sandbox: {
      stop: async () => {},
    },
  }),
}))
mock.module('ai', () => ({
  ToolLoopAgent: class {
    async stream({
      onStepFinish,
    }: {
      onStepFinish: (stepResult: {
        toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>
        toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }>
      }) => void
    }) {
      onStepFinish({
        toolCalls: [{ toolCallId: 'call-1', toolName: 'bash', input: '{"command":"ls"}' }],
        toolResults: [
          { toolCallId: 'call-1', toolName: 'bash', output: { stdout: 'README.md' } },
          { toolCallId: 'orphan-2', toolName: 'readFile', output: { error: 'missing file' } },
        ],
      })

      return {
        textStream: (async function* () {
          yield 'OpenAI '
          yield 'reply'
        })(),
        response: Promise.resolve({ id: 'resp_demo_123' }),
      }
    }
  },
  stepCountIs: () => () => false,
}))
mock.module('../src/services/openai-auth', () => ({
  resolveOpenAiProvider: async () => ({
    provider: {
      chat: () => ({}),
      responses: () => ({}),
    },
    source: 'api-key',
  }),
  validateCodexModel: () => {},
}))

const { createOpenAiAdapter } = await import('../src/pipeline/adapters/openai')
const openAiFrames = await collectFrames(
  createOpenAiAdapter({
    appConfig: {
      ...DEFAULT_CONFIG,
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      ttsEnabled: false,
    },
    session: undefined,
    abortController: new AbortController(),
  }).stream('list files'),
)

for (const frame of openAiFrames) {
  if (frame.kind === 'tool-call-start') {
    console.log(
      `    tool-call-start     → index=${frame.toolCall.index} name=${frame.toolCall.name} input=${JSON.stringify(frame.toolCall.input)}`,
    )
  }
  if (frame.kind === 'tool-call-result') {
    console.log(
      `    tool-call-result    → index=${frame.toolIndex} status=${frame.status} result=${JSON.stringify(frame.result)}`,
    )
  }
  if (frame.kind === 'agent-text-delta') {
    console.log(`    agent-text-delta    → ${JSON.stringify(frame.delta)}`)
  }
  if (frame.kind === 'agent-text-complete') {
    console.log(`    agent-text-complete → ${JSON.stringify(frame.text)}`)
  }
}

mock.restore()

console.log('\n  Notice the orphan OpenAI result created a synthetic tool-call-start with an empty input object.')
