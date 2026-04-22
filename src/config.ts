import { Command } from 'commander'
import packageJson from '../package.json' with { type: 'json' }
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
export const ORB_VERSION = packageJson.version

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

interface ProgramDefaults {
  config: AppConfig
}

const HELP_EPILOGUE = `
Auto provider selection (when --provider and --model are omitted):
  1) Claude Agent SDK (Claude Code / Max or API key)
  2) OPENAI_API_KEY
  3) ANTHROPIC_API_KEY

Examples:
  orb                           # Current directory with defaults
  orb /path/to/project          # Specific project
  orb setup                     # Create ~/.orb/config.toml
  orb --voice=marius
  orb --provider=openai --model=gpt-5.4
  orb --model=openai:gpt-5.4

Controls:
  - Type your question and press Enter
  - Use Ctrl+J or Alt+Enter for a newline
  - Paste MacWhisper transcription with Cmd+V
  - Shift+Tab to cycle models
  - Ctrl+C to exit

TTS quick start:
  - Serve mode uses tts-gateway at http://localhost:8000 by default
  - Streaming playback prefers mpv or ffplay when available
  - Run "orb setup" for guided defaults and gateway instructions
  - Use --tts-mode=generate for local macOS fallback speech

Config:
  Persistent defaults live in ~/.orb/config.toml
  CLI flags override config values for one-off runs`

function createProgram({ config: defaults }: ProgramDefaults): Command {
  const program = new Command()
    .name('orb')
    .description('Voice-Driven Code Explorer')
    .version(ORB_VERSION)
    .argument('[projectPath]', 'Project directory path')
    .option('--provider <provider>', 'LLM provider: anthropic|claude, openai|gpt')
    .option('--llm-provider <provider>', 'LLM provider (alias for --provider)')
    .option('--model <model>', 'Model ID, alias (haiku, sonnet, opus), or provider:model')
    .option('--voice <voice>', `TTS voice: ${VOICES.join(', ')}`, defaults.ttsVoice)
    .option(
      '--tts-mode <mode>',
      'TTS mode: serve (tts-gateway HTTP server), generate (local macOS say), server',
      defaults.ttsMode,
    )
    .option('--tts-server-url <url>', 'Serve-mode tts-gateway URL (default: http://localhost:8000)')
    .option(
      '--tts-speed <rate>',
      'TTS speed multiplier (local playback rate)',
      positiveFloat,
      defaults.ttsSpeed,
    )
    .option('--new', 'Start fresh (ignore saved session)')
    .option('--skip-intro', 'Skip the welcome animation')
    .option('--tts', 'Enable text-to-speech (default: true)')
    .option('--no-tts', 'Disable text-to-speech')
    .option('--streaming-tts', 'Enable streaming TTS (default: true)')
    .option('--no-streaming-tts', 'Disable streaming (batch mode)')
    .option('--yolo', 'Bypass permission prompts and write clamping (dangerous)')
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
  new?: boolean
  skipIntro?: boolean
  tts?: boolean
  streamingTts?: boolean
  yolo?: boolean
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

interface ParseCliOptions {
  baseConfig?: AppConfig
  baseExplicit?: Partial<ExplicitFlags>
}

function isUserSet(program: Command, name: string): boolean {
  return program.getOptionValueSource(name) === 'cli'
}

export function parseCliArgs(args: string[], options: ParseCliOptions = {}): ParseResult {
  const baseConfig = options.baseConfig ?? DEFAULT_CONFIG
  const baseExplicit = options.baseExplicit ?? {}
  const program = createProgram({ config: baseConfig })
  program.parse(args, { from: 'user' })

  const opts = program.opts<ParsedOpts>()
  const projectPath = program.args[0] ?? baseConfig.projectPath

  const config: AppConfig = {
    ...baseConfig,
    projectPath,
    startFresh: opts.new ?? false,
    skipIntro: isUserSet(program, 'skipIntro') ? opts.skipIntro === true : baseConfig.skipIntro,
    ttsEnabled: isUserSet(program, 'tts') ? opts.tts !== false : baseConfig.ttsEnabled,
    ttsStreamingEnabled: isUserSet(program, 'streamingTts')
      ? opts.streamingTts !== false
      : baseConfig.ttsStreamingEnabled,
    ttsSpeed: opts.ttsSpeed,
    yolo: isUserSet(program, 'yolo') ? opts.yolo === true : baseConfig.yolo,
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
    provider:
      baseExplicit.provider === true ||
      isUserSet(program, 'provider') ||
      isUserSet(program, 'llmProvider'),
    model: baseExplicit.model === true || isUserSet(program, 'model'),
    ttsBufferSentences: baseExplicit.ttsBufferSentences === true,
    ttsMinChunkLength: baseExplicit.ttsMinChunkLength === true,
    ttsMaxWaitMs: baseExplicit.ttsMaxWaitMs === true,
    ttsGraceWindowMs: baseExplicit.ttsGraceWindowMs === true,
    ttsClauseBoundaries: baseExplicit.ttsClauseBoundaries === true,
  }

  return { config, explicit }
}

export { DEFAULT_CONFIG, DEFAULT_MODEL_BY_PROVIDER }
