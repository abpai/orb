import { describe, expect, it } from 'bun:test'

import { DEFAULT_CONFIG } from '../../types'
import {
  appendOpenAiAgentMessageDelta,
  createOpenAiAgentMessageAccumulator,
  createOpenAiInitializeParams,
  createOpenAiThreadParams,
  createOpenAiTurnStartParams,
  isOpenAiFullHistoryCapabilityError,
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
