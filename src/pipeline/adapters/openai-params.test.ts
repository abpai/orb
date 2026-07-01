import { describe, expect, it } from 'bun:test'

import { DEFAULT_CONFIG } from '../../types'
import {
  appendOpenAiAgentMessageDelta,
  createOpenAiAgentMessageAccumulator,
  createOpenAiInitializeParams,
  createOpenAiThreadParams,
  createOpenAiTurnStartParams,
  isOpenAiFullHistoryCapabilityError,
  startOrResumeOpenAiThread,
} from './codex-params'

describe('OpenAI app-server params', () => {
  it('declares experimental API support for full-history thread persistence', () => {
    expect(createOpenAiInitializeParams()).toEqual(
      expect.objectContaining({
        clientInfo: expect.objectContaining({ name: 'orb' }),
        capabilities: { experimentalApi: true },
      }),
    )
  })

  it('uses the configured model and reasoning effort for thread and turn startup', () => {
    const appConfig = {
      ...DEFAULT_CONFIG,
      projectPath: '/tmp/orb-project',
      llmModel: 'gpt-5.5',
      llmReasoningEffort: 'high' as const,
    }

    expect(createOpenAiThreadParams(appConfig, 'developer instructions')).toEqual(
      expect.objectContaining({
        model: 'gpt-5.5',
        modelProvider: 'openai',
        config: { model_reasoning_effort: 'high' },
        developerInstructions: 'developer instructions',
        persistExtendedHistory: true,
      }),
    )

    expect(
      createOpenAiThreadParams(appConfig, 'developer instructions', {
        persistExtendedHistory: false,
      }),
    ).not.toHaveProperty('persistExtendedHistory')

    expect(createOpenAiTurnStartParams('thread-1', 'hello', 'high')).toEqual({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'hello', text_elements: [] }],
      effort: 'high',
    })
  })
})

describe('OpenAI app-server compatibility', () => {
  it('detects full-history capability errors for retry without persistence', () => {
    expect(
      isOpenAiFullHistoryCapabilityError(
        new Error('thread/start.persistFullHistory requires experimentalApi capability'),
      ),
    ).toBe(true)

    expect(isOpenAiFullHistoryCapabilityError(new Error('other app-server error'))).toBe(false)
  })

  it('refuses to start a fresh thread when an explicit resume fails', async () => {
    const calls: Array<{ method: string; params?: unknown }> = []
    const client = {
      async request(method: string, params?: unknown): Promise<unknown> {
        calls.push({ method, params })
        if (method === 'thread/resume') throw new Error('thread not found')
        throw new Error(`unexpected ${method}`)
      },
    }

    await expect(
      startOrResumeOpenAiThread(
        client,
        createOpenAiThreadParams(DEFAULT_CONFIG, 'developer instructions'),
        'thread-missing',
      ),
    ).rejects.toThrow(
      'Could not resume Codex thread thread-missing; refusing to start a fresh thread',
    )
    expect(calls.map((call) => call.method)).toEqual(['thread/resume'])
  })

  it('explains --new for implicit saved-session resume failures', async () => {
    const client = {
      async request(method: string): Promise<unknown> {
        if (method === 'thread/resume') throw new Error('thread not found')
        throw new Error(`unexpected ${method}`)
      },
    }

    await expect(
      startOrResumeOpenAiThread(
        client,
        createOpenAiThreadParams(DEFAULT_CONFIG, 'developer instructions'),
        'thread-missing',
        { explicitResume: false },
      ),
    ).rejects.toThrow('Start explicitly with `orb --new`')
  })

  it('keeps the full-history resume retry on the same thread', async () => {
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = []
    const client = {
      async request(method: string, params?: unknown): Promise<unknown> {
        calls.push({ method, params: params as Record<string, unknown> })
        if (calls.length === 1) {
          throw new Error('thread/start.persistFullHistory requires experimentalApi capability')
        }
        return { thread: { id: 'thread-1' } }
      },
    }
    const appConfig = { ...DEFAULT_CONFIG, llmModel: 'gpt-5.5' }

    let threadId: string
    try {
      threadId = await startOrResumeOpenAiThread(
        client,
        createOpenAiThreadParams(appConfig, 'developer instructions'),
        'thread-1',
      )
    } catch (err) {
      if (!isOpenAiFullHistoryCapabilityError(err)) throw err
      threadId = await startOrResumeOpenAiThread(
        client,
        createOpenAiThreadParams(appConfig, 'developer instructions', {
          persistExtendedHistory: false,
        }),
        'thread-1',
      )
    }

    expect(threadId).toBe('thread-1')
    expect(calls.map((call) => call.method)).toEqual(['thread/resume', 'thread/resume'])
    expect(calls[0]?.params?.persistExtendedHistory).toBe(true)
    expect(calls[1]?.params).not.toHaveProperty('persistExtendedHistory')
  })
})

describe('OpenAI app-server text streaming', () => {
  it('separates distinct agent message items as paragraphs', () => {
    const accumulator = createOpenAiAgentMessageAccumulator()

    expect(
      appendOpenAiAgentMessageDelta(accumulator, {
        itemId: 'msg-1',
        delta: 'I will inspect the goal first.',
      }),
    ).toEqual({
      delta: 'I will inspect the goal first.',
      accumulatedText: 'I will inspect the goal first.',
    })

    expect(
      appendOpenAiAgentMessageDelta(accumulator, {
        itemId: 'msg-2',
        delta: 'I found the active plan.',
      }),
    ).toEqual({
      delta: '\n\nI found the active plan.',
      accumulatedText: 'I will inspect the goal first.\n\nI found the active plan.',
    })
  })
})
