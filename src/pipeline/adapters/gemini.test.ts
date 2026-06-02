import { afterEach, describe, expect, it, mock } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { DEFAULT_CONFIG } from '../../types'

afterEach(() => {
  mock.restore()
})

describe('createGeminiAdapter', () => {
  it('configures a ToolLoopAgent with Gemini instructions and sandbox context', async () => {
    const constructorArgs: Array<Record<string, unknown>> = []
    let streamArgs: Record<string, unknown> | undefined

    mock.module('../../services/gemini-auth', () => ({
      resolveGeminiProvider: async () => ({
        provider: () => ({ id: 'mock-gemini-model' }),
      }),
    }))

    mock.module('../../services/prompts', () => ({
      buildProviderPrompt: async () => 'You are a helpful coding assistant.\n\nPrompt from files.',
    }))

    mock.module('ai', () => ({
      tool: (def: unknown) => def,
      stepCountIs: (count: number) => count,
      ToolLoopAgent: class {
        constructor(args: Record<string, unknown>) {
          constructorArgs.push(args)
        }

        async stream(args: Record<string, unknown>) {
          streamArgs = args
          return {
            textStream: (async function* () {})(),
          }
        }
      },
    }))

    const { createGeminiAdapter } = await import('./gemini')
    const adapter = createGeminiAdapter({
      appConfig: {
        ...DEFAULT_CONFIG,
        llmProvider: 'gemini',
        llmModel: 'gemini-3.1-pro-preview',
      },
      session: undefined,
      abortController: new AbortController(),
    })

    const frames = []
    for await (const frame of adapter.stream('continue')) {
      frames.push(frame)
    }

    expect(constructorArgs).toHaveLength(1)
    expect(constructorArgs[0]?.instructions).toBe(
      'You are a helpful coding assistant.\n\nPrompt from files.',
    )
    expect(constructorArgs[0]?.providerOptions).toBeUndefined()
    expect(frames.at(-1)).toEqual(
      expect.objectContaining({
        kind: 'agent-text-complete',
        text: '',
      }),
    )

    expect(streamArgs?.experimental_context).toBeDefined()
    const ctx = streamArgs?.experimental_context as { sandbox?: unknown; signal?: unknown }
    expect(ctx.sandbox).toBeDefined()
    expect(typeof (ctx.sandbox as { dispose?: unknown }).dispose).toBe('function')
    expect(typeof (ctx.sandbox as { exec?: unknown }).exec).toBe('function')
    expect(typeof (ctx.sandbox as { readFile?: unknown }).readFile).toBe('function')
    expect(typeof (ctx.sandbox as { writeFile?: unknown }).writeFile).toBe('function')
    expect(typeof (ctx.sandbox as { rootDir?: unknown }).rootDir).toBe('string')
    expect(ctx.signal).toBeInstanceOf(AbortSignal)
  })

  it('passes yolo through to the sandbox factory', async () => {
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orb-gemini-yolo-')))
    const outsideDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'orb-gemini-outside-')),
    )
    const outsideFile = path.join(outsideDir, 'written.txt')
    let streamArgs: Record<string, unknown> | undefined

    try {
      mock.module('../../services/gemini-auth', () => ({
        resolveGeminiProvider: async () => ({
          provider: () => ({ id: 'mock-gemini-model' }),
        }),
      }))

      mock.module('../../services/prompts', () => ({
        buildProviderPrompt: async () => 'Prompt from files.',
      }))

      mock.module('ai', () => ({
        tool: (def: unknown) => def,
        stepCountIs: (count: number) => count,
        ToolLoopAgent: class {
          async stream(args: Record<string, unknown>) {
            streamArgs = args
            return {
              textStream: (async function* () {})(),
            }
          }
        },
      }))

      const { createGeminiAdapter } = await import(
        `./gemini?yolo-test=${Date.now()}-${Math.random()}`
      )
      const adapter = createGeminiAdapter({
        appConfig: {
          ...DEFAULT_CONFIG,
          projectPath: projectRoot,
          llmProvider: 'gemini',
          llmModel: 'gemini-3.1-pro-preview',
          yolo: true,
        },
        session: undefined,
        abortController: new AbortController(),
      })

      for await (const _frame of adapter.stream('continue')) {
        // no-op
      }

      const sandbox = (
        streamArgs?.experimental_context as
          | {
              sandbox?: { writeFile: (path: string, content: string) => Promise<void> }
            }
          | undefined
      )?.sandbox
      expect(sandbox).not.toBeNull()
      await sandbox!.writeFile(outsideFile, 'hello from gemini yolo\n')
      expect(fs.readFileSync(outsideFile, 'utf8')).toBe('hello from gemini yolo\n')
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true })
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})
