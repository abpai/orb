import { afterEach, describe, expect, it, mock } from 'bun:test'

import { DEFAULT_CONFIG } from '../../types'

afterEach(() => {
  mock.restore()
})

describe('createOpenAiAdapter', () => {
  it('moves resume instructions into provider options when continuing a response', async () => {
    const constructorArgs: Array<Record<string, unknown>> = []

    mock.module('bash-tool', () => ({
      createBashTool: async () => ({
        tools: {
          bash: {},
          readFile: {},
          writeFile: {},
        },
        sandbox: {},
      }),
    }))

    mock.module('../../services/openai-auth', () => ({
      resolveOpenAiProvider: async () => ({
        provider: {
          responses: () => ({ id: 'mock-model' }),
        },
      }),
    }))

    mock.module('ai', () => ({
      stepCountIs: (count: number) => count,
      ToolLoopAgent: class {
        constructor(args: Record<string, unknown>) {
          constructorArgs.push(args)
        }

        async stream() {
          return {
            textStream: (async function* () {})(),
            response: Promise.resolve({ id: 'resp_next' }),
          }
        }
      },
    }))

    const { createOpenAiAdapter } = await import('./openai')
    const adapter = createOpenAiAdapter({
      appConfig: {
        ...DEFAULT_CONFIG,
        llmProvider: 'openai',
        llmModel: 'gpt-5.4',
      },
      session: {
        provider: 'openai',
        previousResponseId: 'resp_prev',
      },
      abortController: new AbortController(),
    })

    const frames = []
    for await (const frame of adapter.stream('continue')) {
      frames.push(frame)
    }

    expect(constructorArgs).toHaveLength(1)
    expect(constructorArgs[0]?.instructions).toBeUndefined()
    expect(constructorArgs[0]?.providerOptions).toEqual({
      openai: expect.objectContaining({
        truncation: 'auto',
        previousResponseId: 'resp_prev',
        instructions: expect.stringContaining('You are a helpful coding assistant.'),
      }),
    })
    expect(frames.at(-1)).toEqual(
      expect.objectContaining({
        kind: 'agent-text-complete',
        session: { provider: 'openai', previousResponseId: 'resp_next' },
      }),
    )
  })
})
