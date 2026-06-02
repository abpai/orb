import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_CONFIG } from '../types'
import {
  FALLBACK_MODEL_CHOICES_BY_PROVIDER,
  loadModelCatalog,
  resolveAppModelConfig,
} from './model-catalog'

const tempDirs: string[] = []
type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<Response>

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function jsonFetch(payload: unknown): FetchImpl {
  return async () => new Response(JSON.stringify(payload), { status: 200 })
}

function failingFetch(message = 'network down'): FetchImpl {
  return async () => {
    throw new Error(message)
  }
}

async function tempCachePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orb-model-catalog-'))
  tempDirs.push(dir)
  return join(dir, 'gateway.json')
}

describe('model catalog resolution', () => {
  it('resolves OpenAI semantic aliases from the Gateway catalog', async () => {
    const cachePath = await tempCachePath()
    const resolved = await resolveAppModelConfig(
      {
        ...DEFAULT_CONFIG,
        llmProvider: 'openai',
        llmModel: 'gpt',
      },
      {
        cachePath,
        now: 1000,
        fetchImpl: jsonFetch({
          data: [
            { id: 'openai/gpt-5.4', type: 'language', name: 'GPT 5.4', released: 1 },
            { id: 'openai/gpt-5.5', type: 'language', name: 'GPT 5.5', released: 2 },
            {
              id: 'openai/gpt-5.5-pro',
              type: 'language',
              name: 'GPT 5.5 Pro',
              released: 2,
            },
            {
              id: 'openai/gpt-5.4-mini',
              type: 'language',
              name: 'GPT 5.4 Mini',
              released: 1,
            },
          ],
        }),
      },
    )

    expect(resolved.llmModel).toBe('gpt-5.5')
    expect(resolved.llmModelChoices).toContain('gpt-5.5')
    expect(resolved.llmModelChoices).toContain('gpt-5.5-pro')
    expect(resolved.llmModelLabels['gpt-5.5']).toBe('GPT 5.5')
  })

  it('adapts AI Gateway model IDs to provider-native runtime IDs', async () => {
    const cachePath = await tempCachePath()
    const resolved = await resolveAppModelConfig(
      {
        ...DEFAULT_CONFIG,
        llmProvider: 'gemini',
        llmModel: 'google/gemini-3.1-pro-preview',
      },
      {
        cachePath,
        now: 1000,
        fetchImpl: jsonFetch({
          data: [
            {
              id: 'google/gemini-3.1-pro-preview',
              type: 'language',
              name: 'Gemini 3.1 Pro Preview',
              released: 1,
            },
          ],
        }),
      },
    )

    expect(resolved.llmModel).toBe('gemini-3.1-pro-preview')
  })

  it('keeps the Anthropic cycle to the latest model for each semantic family', async () => {
    const cachePath = await tempCachePath()
    const resolved = await resolveAppModelConfig(
      {
        ...DEFAULT_CONFIG,
        llmProvider: 'anthropic',
        llmModel: 'opus',
      },
      {
        cachePath,
        now: 1000,
        fetchImpl: jsonFetch({
          data: [
            {
              id: 'anthropic/claude-haiku-4.5',
              type: 'language',
              name: 'Claude Haiku 4.5',
              released: 1,
            },
            {
              id: 'anthropic/claude-sonnet-4.6',
              type: 'language',
              name: 'Claude Sonnet 4.6',
              released: 2,
            },
            {
              id: 'anthropic/claude-opus-4.5',
              type: 'language',
              name: 'Claude Opus 4.5',
              released: 1,
            },
            {
              id: 'anthropic/claude-opus-4.6',
              type: 'language',
              name: 'Claude Opus 4.6',
              released: 2,
            },
            {
              id: 'anthropic/claude-opus-4.7',
              type: 'language',
              name: 'Claude Opus 4.7',
              released: 3,
            },
          ],
        }),
      },
    )

    expect(resolved.llmModel).toBe('claude-opus-4-7')
    expect(resolved.llmModelChoices).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-6',
      'claude-opus-4-7',
    ])
    expect(resolved.llmModelChoices).not.toContain('claude-opus-4-6')
    expect(resolved.llmModelChoices).not.toContain('claude-opus-4-5')
    expect(resolved.llmModelLabels['claude-opus-4-7']).toBe('Opus 4.7')
  })

  it('resolves Anthropic family-version shorthand to the catalog model id', async () => {
    const payload = {
      data: [
        {
          id: 'anthropic/claude-opus-4.8',
          type: 'language',
          name: 'Claude Opus 4.8',
          released: 4,
        },
      ],
    }

    for (const model of ['opus-4.8', 'claude-opus-4.8', 'anthropic/claude-opus-4.8']) {
      const resolved = await resolveAppModelConfig(
        {
          ...DEFAULT_CONFIG,
          llmProvider: 'anthropic',
          llmModel: model,
        },
        {
          cachePath: await tempCachePath(),
          now: 1000,
          fetchImpl: jsonFetch(payload),
        },
      )

      expect(resolved.llmModel).toBe('claude-opus-4-8')
      expect(resolved.llmModelLabels['claude-opus-4-8']).toBe('Opus 4.8')
    }
  })

  it('uses fallback choices when the Gateway catalog is unavailable', async () => {
    const cachePath = await tempCachePath()
    const resolved = await resolveAppModelConfig(
      {
        ...DEFAULT_CONFIG,
        llmProvider: 'gemini',
        llmModel: 'pro',
      },
      {
        cachePath,
        fetchImpl: failingFetch(),
      },
    )

    expect(resolved.catalog.source).toBe('fallback')
    expect(resolved.catalog.warning).toBe('network down')
    expect(resolved.llmModel).toBe(FALLBACK_MODEL_CHOICES_BY_PROVIDER.gemini[0]!)
    expect(resolved.llmModelChoices).toEqual(FALLBACK_MODEL_CHOICES_BY_PROVIDER.gemini)
  })

  it('uses a fresh cache without hitting the network', async () => {
    const cachePath = await tempCachePath()
    await loadModelCatalog({
      cachePath,
      now: 1000,
      fetchImpl: jsonFetch({
        data: [{ id: 'openai/gpt-5.5', type: 'language', name: 'GPT 5.5', released: 1 }],
      }),
    })

    const cached = await loadModelCatalog({
      cachePath,
      now: 2000,
      fetchImpl: failingFetch('should not fetch'),
    })

    expect(cached.source).toBe('cache')
    expect(cached.models.map((model) => model.nativeId)).toEqual(['gpt-5.5'])
  })
})
