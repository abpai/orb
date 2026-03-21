import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '../types'
import {
  applyGlobalConfig,
  loadGlobalConfig,
  parseGlobalConfigToml,
  serializeGlobalConfig,
  writeGlobalConfig,
} from './global-config'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('parseGlobalConfigToml', () => {
  it('parses stable top-level and tts values', () => {
    const result = parseGlobalConfigToml(`
provider = "openai"
model = "gpt-5.4"
skip_intro = true

[tts]
enabled = false
streaming = false
mode = "serve"
server_url = "http://voicebox.local:8000"
voice = "jean"
speed = 1.75
buffer_sentences = 4
clause_boundaries = true
min_chunk_length = 90
max_wait_ms = 650
grace_window_ms = 220
`)

    expect(result.warnings).toEqual([])
    expect(result.config).toEqual({
      provider: 'openai',
      model: 'gpt-5.4',
      skipIntro: true,
      tts: {
        enabled: false,
        streaming: false,
        mode: 'serve',
        serverUrl: 'http://voicebox.local:8000',
        voice: 'jean',
        speed: 1.75,
        bufferSentences: 4,
        clauseBoundaries: true,
        minChunkLength: 90,
        maxWaitMs: 650,
        graceWindowMs: 220,
      },
    })
    expect(result.explicit).toEqual({
      provider: true,
      model: true,
      ttsBufferSentences: true,
      ttsClauseBoundaries: true,
      ttsMinChunkLength: true,
      ttsMaxWaitMs: true,
      ttsGraceWindowMs: true,
    })
  })

  it('warns on malformed TOML', () => {
    const result = parseGlobalConfigToml('provider = [', '/tmp/orb/config.toml')
    expect(result.config).toEqual({})
    expect(result.warnings[0]).toContain('Failed to parse Orb config')
  })

  it('warns on invalid values and ignores them', () => {
    const result = parseGlobalConfigToml(`
provider = "bogus"

[tts]
voice = "nope"
speed = -1
buffer_sentences = 0
`)

    expect(result.config).toEqual({})
    expect(result.warnings).toContain('provider must be "anthropic" or "openai".')
    expect(result.warnings).toContain('tts.voice must be one of: alba, marius, jean.')
    expect(result.warnings).toContain('tts.speed must be a positive number.')
    expect(result.warnings).toContain('tts.buffer_sentences must be a positive integer.')
  })
})

describe('load/write global config', () => {
  it('returns empty config when file is missing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-global-config-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.toml')

    const result = await loadGlobalConfig(configPath)
    expect(result.exists).toBe(false)
    expect(result.config).toEqual({})
    expect(result.warnings).toEqual([])
  })

  it('writes normalized TOML that round-trips through the loader', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-global-config-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.toml')

    await writeGlobalConfig(
      {
        provider: 'openai',
        model: 'gpt-5.4-mini',
        skipIntro: true,
        tts: {
          enabled: true,
          streaming: false,
          mode: 'serve',
          serverUrl: 'http://voicebox.local:8000',
          voice: 'alba',
          speed: 2,
        },
      },
      configPath,
    )

    const raw = await readFile(configPath, 'utf8')
    expect(raw).toContain('provider = "openai"')
    expect(raw).toContain('skip_intro = true')
    expect(raw).toContain('[tts]')

    const loaded = await loadGlobalConfig(configPath)
    expect(loaded.config.provider).toBe('openai')
    expect(loaded.config.tts?.serverUrl).toBe('http://voicebox.local:8000')
  })
})

describe('applyGlobalConfig', () => {
  it('merges global defaults onto the app config', () => {
    const result = applyGlobalConfig(DEFAULT_CONFIG, {
      provider: 'openai',
      skipIntro: true,
      tts: {
        serverUrl: 'http://voicebox.local:8000',
        speed: 2,
      },
    })

    expect(result.llmProvider).toBe('openai')
    expect(result.llmModel).toBe('gpt-5.4')
    expect(result.skipIntro).toBe(true)
    expect(result.ttsServerUrl).toBe('http://voicebox.local:8000')
    expect(result.ttsSpeed).toBe(2)
  })

  it('serializes only defined values', () => {
    const raw = serializeGlobalConfig({
      provider: 'anthropic',
      tts: { enabled: true, voice: 'marius' },
    })

    expect(raw).toContain('provider = "anthropic"')
    expect(raw).toContain('enabled = true')
    expect(raw).toContain('voice = "marius"')
    expect(raw).not.toContain('skip_intro')
  })
})
