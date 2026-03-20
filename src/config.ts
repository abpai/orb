import { Command } from 'commander'
import type { AnthropicModel, AppConfig, LlmModelId, LlmProvider, Voice } from './types'
import { ANTHROPIC_MODELS, DEFAULT_CONFIG, VOICES } from './types'

const PROVIDER_ALIASES: Record<string, LlmProvider> = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  gpt: 'openai',
}

const ANTHROPIC_MODEL_ALIASES: Record<string, AnthropicModel> = {
  opus: 'claude-opus-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
}

const DEFAULT_MODEL_BY_PROVIDER: Record<LlmProvider, LlmModelId> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5.4',
}

function normalizeProvider(value: string): LlmProvider | undefined {
  return PROVIDER_ALIASES[value.trim().toLowerCase()]
}

function normalizeAnthropicModel(value: string): LlmModelId {
  const normalized = value.trim()
  const alias = ANTHROPIC_MODEL_ALIASES[normalized]
  if (alias) return alias
  if (ANTHROPIC_MODELS.includes(normalized as AnthropicModel)) return normalized
  return normalized || DEFAULT_MODEL_BY_PROVIDER.anthropic
}

function normalizeModelForProvider(provider: LlmProvider, value: string): LlmModelId {
  if (provider === 'anthropic') return normalizeAnthropicModel(value)
  return value.trim() || DEFAULT_MODEL_BY_PROVIDER.openai
}

function isAnthropicModel(value: string): boolean {
  return ANTHROPIC_MODELS.includes(value as AnthropicModel) || value in ANTHROPIC_MODEL_ALIASES
}

function resolveModelForConfig(provider: LlmProvider, modelId: string): LlmModelId {
  const normalized = normalizeModelForProvider(provider, modelId)
  if (provider === 'openai' && isAnthropicModel(normalized)) {
    return DEFAULT_MODEL_BY_PROVIDER.openai
  }
  return normalized
}

type ModelOverride = { provider?: LlmProvider; id: string }

function parseModelArg(value: string): ModelOverride | undefined {
  if (!value) return undefined
  if (!value.includes(':')) return { id: value }

  const [prefix, id] = value.split(':', 2)
  const trimmedPrefix = prefix?.trim() ?? ''
  const trimmedId = id?.trim() ?? ''
  if (!trimmedPrefix || !trimmedId) return undefined

  const provider = normalizeProvider(trimmedPrefix)
  return provider ? { provider, id: trimmedId } : { id: value }
}

function positiveFloat(value: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Expected a positive number, got "${value}"`)
  return n
}

function positiveInt(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Expected a positive integer, got "${value}"`)
  return n
}

function nonNegativeInt(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`Expected a non-negative integer, got "${value}"`)
  return n
}

const HELP_EPILOGUE = `
Auto provider selection (when --provider and --model are omitted):
  1) Claude Agent SDK (Claude Code / Max or API key)
  2) OPENAI_API_KEY
  3) ANTHROPIC_API_KEY

Examples:
  orb                           # Current directory with defaults
  orb /path/to/project          # Specific project
  orb --voice=marius
  orb --provider=openai --model=gpt-5.4
  orb --model=openai:gpt-5.4

Controls:
  - Type your question and press Enter
  - Paste MacWhisper transcription with Cmd+V
  - Shift+Tab to cycle models
  - Ctrl+C to exit`

function createProgram(): Command {
  const program = new Command()
    .name('orb')
    .description('Voice-Driven Code Explorer')
    .argument('[projectPath]', 'Project directory path')
    .option('--provider <provider>', 'LLM provider: anthropic|claude, openai|gpt')
    .option('--llm-provider <provider>', 'LLM provider (alias for --provider)')
    .option('--model <model>', 'Model ID, alias (haiku, sonnet, opus), or provider:model')
    .option('--voice <voice>', `TTS voice: ${VOICES.join(', ')}`, DEFAULT_CONFIG.ttsVoice)
    .option('--tts-mode <mode>', 'TTS mode: generate, serve, server', DEFAULT_CONFIG.ttsMode)
    .option('--tts-server-url <url>', 'TTS gateway server URL')
    .option('--tts-speed <rate>', 'TTS speed multiplier', positiveFloat, DEFAULT_CONFIG.ttsSpeed)
    .option(
      '--tts-buffer-sentences <count>',
      'Sentences to buffer before playback',
      positiveInt,
      DEFAULT_CONFIG.ttsBufferSentences,
    )
    .option('--tts-clause-boundaries', 'Enable clause split points')
    .option('--no-tts-clause-boundaries', 'Disable clause split points')
    .option(
      '--tts-min-chunk-length <count>',
      'Minimum chars before soft flush',
      nonNegativeInt,
      DEFAULT_CONFIG.ttsMinChunkLength,
    )
    .option(
      '--tts-max-wait-ms <ms>',
      'Max latency before forcing a flush',
      nonNegativeInt,
      DEFAULT_CONFIG.ttsMaxWaitMs,
    )
    .option(
      '--tts-grace-window-ms <ms>',
      'Extra wait when near a boundary',
      nonNegativeInt,
      DEFAULT_CONFIG.ttsGraceWindowMs,
    )
    .option('--new', 'Start fresh (ignore saved session)')
    .option('--skip-intro', 'Skip the welcome animation')
    .option('--tts', 'Enable text-to-speech (default: true)')
    .option('--no-tts', 'Disable text-to-speech')
    .option('--streaming-tts', 'Enable streaming TTS (default: true)')
    .option('--no-streaming-tts', 'Disable streaming (batch mode)')
    .addHelpText('after', HELP_EPILOGUE)
    .configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
    })
    .exitOverride()

  return program
}

interface ParsedOpts {
  provider?: string
  llmProvider?: string
  model?: string
  voice: string
  ttsMode: string
  ttsServerUrl?: string
  ttsSpeed: number
  ttsBufferSentences: number
  ttsClauseBoundaries?: boolean
  ttsMinChunkLength: number
  ttsMaxWaitMs: number
  ttsGraceWindowMs: number
  new?: boolean
  skipIntro?: boolean
  tts?: boolean
  streamingTts?: boolean
}

export interface ParseResult {
  config: AppConfig
  explicit: ExplicitFlags
}

export interface ExplicitFlags {
  provider: boolean
  model: boolean
  ttsBufferSentences: boolean
  ttsMinChunkLength: boolean
  ttsMaxWaitMs: boolean
  ttsGraceWindowMs: boolean
  ttsClauseBoundaries: boolean
}

function isUserSet(program: Command, name: string): boolean {
  return program.getOptionValueSource(name) === 'cli'
}

export function parseCliArgs(args: string[]): ParseResult {
  const program = createProgram()
  program.parse(args, { from: 'user' })

  const opts = program.opts<ParsedOpts>()
  const projectPath = program.args[0] ?? DEFAULT_CONFIG.projectPath

  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    projectPath,
    startFresh: opts.new ?? false,
    skipIntro: opts.skipIntro ?? false,
    ttsEnabled: opts.tts !== false,
    ttsStreamingEnabled: opts.streamingTts !== false,
    ttsSpeed: opts.ttsSpeed,
    ttsBufferSentences: opts.ttsBufferSentences,
    ttsMinChunkLength: opts.ttsMinChunkLength,
    ttsMaxWaitMs: opts.ttsMaxWaitMs,
    ttsGraceWindowMs: opts.ttsGraceWindowMs,
  }

  // Voice validation
  if (VOICES.includes(opts.voice as Voice)) {
    config.ttsVoice = opts.voice as Voice
  }

  // TTS mode (normalize "server" → "serve")
  const ttsMode = opts.ttsMode
  if (ttsMode === 'generate' || ttsMode === 'serve') {
    config.ttsMode = ttsMode
  } else if (ttsMode === 'server') {
    config.ttsMode = 'serve'
  }

  // TTS server URL
  if (opts.ttsServerUrl) {
    config.ttsServerUrl = opts.ttsServerUrl.trim()
    if (config.ttsMode === 'generate') config.ttsMode = 'serve'
  }

  // Clause boundaries (Commander handles --no- prefix)
  if (opts.ttsClauseBoundaries !== undefined) {
    config.ttsClauseBoundaries = opts.ttsClauseBoundaries
  }

  // Provider and model resolution
  const providerRaw = opts.provider ?? opts.llmProvider
  let providerOverride: LlmProvider | undefined
  if (providerRaw) {
    providerOverride = normalizeProvider(providerRaw)
  }

  let modelOverride: ModelOverride | undefined
  if (opts.model) {
    modelOverride = parseModelArg(opts.model.trim())
  }

  if (modelOverride?.provider) {
    config.llmProvider = modelOverride.provider
  } else if (providerOverride) {
    config.llmProvider = providerOverride
  }

  if (modelOverride) {
    config.llmModel = resolveModelForConfig(config.llmProvider, modelOverride.id)
  } else if (providerOverride) {
    config.llmModel = DEFAULT_MODEL_BY_PROVIDER[config.llmProvider]
  }

  const explicit: ExplicitFlags = {
    provider: isUserSet(program, 'provider') || isUserSet(program, 'llmProvider'),
    model: isUserSet(program, 'model'),
    ttsBufferSentences: isUserSet(program, 'ttsBufferSentences'),
    ttsMinChunkLength: isUserSet(program, 'ttsMinChunkLength'),
    ttsMaxWaitMs: isUserSet(program, 'ttsMaxWaitMs'),
    ttsGraceWindowMs: isUserSet(program, 'ttsGraceWindowMs'),
    ttsClauseBoundaries:
      isUserSet(program, 'ttsClauseBoundaries') || isUserSet(program, 'noTtsClauseBoundaries'),
  }

  return { config, explicit }
}

export { DEFAULT_CONFIG, DEFAULT_MODEL_BY_PROVIDER }
