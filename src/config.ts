import { Command } from 'commander'
import packageJson from '../package.json' with { type: 'json' }
import { buildHelpText } from './cli/help'
import {
  DEFAULT_MODEL_ALIAS_BY_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  isForeignModelAlias,
  isModelAlias,
} from './services/model-catalog'
import {
  TTS_MODES,
  normalizeProvider,
  parseNonNegativeInt,
  parsePositiveInt,
  parsePositiveNumber,
  parseReasoningEffort,
  parseTtsMode,
  parseVoice,
  type Validated,
} from './services/config-values'
import type { AgentSession, AppConfig, LlmModelId, LlmProvider, Voice } from './types'
import { DEFAULT_CONFIG, REASONING_EFFORTS, VOICES, type ReasoningEffort } from './types'

export const ORB_VERSION = packageJson.version

function normalizeModelForProvider(provider: LlmProvider, value: string): LlmModelId {
  const normalized = value.trim()
  if (!normalized) return DEFAULT_MODEL_ALIAS_BY_PROVIDER[provider]
  const lower = normalized.toLowerCase()
  return isModelAlias(provider, lower) ? lower : normalized
}

export function resolveModelForConfig(provider: LlmProvider, modelId: string): LlmModelId {
  const normalized = normalizeModelForProvider(provider, modelId)
  if (isForeignModelAlias(provider, normalized)) {
    return DEFAULT_MODEL_ALIAS_BY_PROVIDER[provider]
  }
  return normalized
}

type ModelOverride = { provider?: LlmProvider; id: string }
type SessionOverride =
  | { provider: 'anthropic'; session: AgentSession }
  | { provider: 'openai'; session: AgentSession }

function parseModelArg(value: string): ModelOverride | undefined {
  if (!value) return undefined
  const slashIndex = value.indexOf('/')
  if (slashIndex > 0) {
    const prefix = value.slice(0, slashIndex).trim()
    const provider = normalizeProvider(prefix)
    if (provider) return { provider, id: value.trim() }
  }
  if (!value.includes(':')) return { id: value }

  const [prefix, id] = value.split(':', 2)
  const trimmedPrefix = prefix?.trim() ?? ''
  const trimmedId = id?.trim() ?? ''
  if (!trimmedPrefix || !trimmedId) return undefined

  const provider = normalizeProvider(trimmedPrefix)
  return provider ? { provider, id: trimmedId } : { id: value }
}

function parseProviderSessionArg(value: string): SessionOverride {
  const separator = value.indexOf(':')
  if (separator <= 0) {
    throw new Error('Expected --resume-session as claude:<session-id> or codex:<thread-id>')
  }

  const prefix = value.slice(0, separator).trim()
  const id = value.slice(separator + 1).trim()
  if (!id) {
    throw new Error('Expected --resume-session to include a non-empty session id')
  }

  const provider = normalizeProvider(prefix)
  switch (provider) {
    case 'anthropic':
      return { provider, session: { provider, sessionId: id } }
    case 'openai':
      return { provider, session: { provider, threadId: id } }
    default:
      throw new Error(
        'Expected --resume-session provider to be claude, anthropic, codex, or openai',
      )
  }
}

function parseBareSessionId(value: string, flagName: string): string {
  const id = value.trim()
  if (!id) throw new Error(`Expected ${flagName} to include a non-empty id`)
  return id
}

function sameSession(a: AgentSession, b: AgentSession): boolean {
  if (a.provider !== b.provider) return false
  if (a.provider === 'anthropic') return a.sessionId === (b as typeof a).sessionId
  return a.threadId === (b as typeof a).threadId
}

function parseSessionOverride(opts: ParsedOpts): SessionOverride | undefined {
  const parsed: SessionOverride[] = []

  if (opts.resumeSession) {
    parsed.push(parseProviderSessionArg(opts.resumeSession))
  }
  if (opts.claudeSession) {
    parsed.push({
      provider: 'anthropic',
      session: {
        provider: 'anthropic',
        sessionId: parseBareSessionId(opts.claudeSession, '--claude-session'),
      },
    })
  }
  if (opts.codexThread) {
    parsed.push({
      provider: 'openai',
      session: {
        provider: 'openai',
        threadId: parseBareSessionId(opts.codexThread, '--codex-thread'),
      },
    })
  }

  if (parsed.length <= 1) return parsed[0]

  const [first, ...rest] = parsed
  if (first && rest.every((item) => sameSession(item.session, first.session))) {
    return first
  }

  throw new Error(
    'Pass only one handoff target: --resume-session, --claude-session, or --codex-thread',
  )
}

function assertSessionProviderMatches(
  sessionOverride: SessionOverride | undefined,
  provider: LlmProvider | undefined,
  source: string,
): void {
  if (!sessionOverride || !provider) return
  if (provider === sessionOverride.provider) return
  throw new Error(
    `${source} selects ${provider}, but the handoff session is for ${sessionOverride.provider}`,
  )
}

/**
 * Adapt a shared {@link Validated} primitive into a Commander parser: on
 * failure it throws Error with `expected` rendered into the existing CLI error
 * format (`Expected <expected>, got "<value>"`, which config.test.ts asserts
 * on); on success it returns the parsed value.
 */
function cliParser<T>(parse: (value: string) => Validated<T>, expected: string) {
  return (value: string): T => {
    const result = parse(value)
    if (!result.ok) throw new Error(`Expected ${expected}, got "${value}"`)
    return result.value
  }
}

const positiveFloat = cliParser(parsePositiveNumber, 'a positive number')
const positiveInt = cliParser(parsePositiveInt, 'a positive integer')
const nonNegativeInt = cliParser(parseNonNegativeInt, 'a non-negative integer')
const reasoningEffort = cliParser(parseReasoningEffort, `one of ${REASONING_EFFORTS.join(', ')}`)
const voiceParser = cliParser(parseVoice, `one of ${VOICES.join(', ')}`)
const ttsModeParser = cliParser(parseTtsMode, `one of ${TTS_MODES.join(', ')}`)

export { buildHelpText } from './cli/help'

interface ProgramDefaults {
  config: AppConfig
}

export function createProgram({ config: defaults }: ProgramDefaults): Command {
  const program = new Command()
    .name('orb')
    .description('Voice-Driven Code Explorer')
    .version(ORB_VERSION)
    .argument('[projectPath]', 'Project directory path')
    .option(
      '--provider <provider>',
      'LLM provider: anthropic|claude, openai|gpt|codex, gemini|google',
    )
    .option('--llm-provider <provider>', 'LLM provider (alias for --provider)')
    .option('--model <model>', 'Model ID, semantic alias, or provider:model')
    .option(
      '--reasoning-effort <effort>',
      'OpenAI/Codex reasoning effort: none|minimal|low|medium|high|xhigh',
      reasoningEffort,
      defaults.llmReasoningEffort,
    )
    .option('--voice <voice>', `TTS voice: ${VOICES.join(', ')}`, voiceParser, defaults.ttsVoice)
    .option(
      '--tts-mode <mode>',
      'TTS mode: serve (tts-gateway HTTP server), generate (local macOS say), server (alias for serve)',
      ttsModeParser,
      defaults.ttsMode as 'serve' | 'generate',
    )
    .option('--tts-server-url <url>', 'Serve-mode tts-gateway URL (default: http://localhost:8000)')
    .option(
      '--tts-speed <rate>',
      'TTS speed multiplier (local playback rate)',
      positiveFloat,
      defaults.ttsSpeed,
    )
    .option(
      '--resume-session <provider:id>',
      'Resume an external provider session: claude:<session-id> or codex:<thread-id>',
    )
    .option('--claude-session <id>', 'Resume a Claude Code session by id')
    .option('--codex-thread <id>', 'Resume a Codex app-server thread by id')
    .option('--new', 'Start fresh (ignore saved session)')
    .option('--resume <id>', 'Resume a specific saved session by id')
    .option('--skip-intro', 'Skip the welcome animation')
    .option('--tts', 'Enable text-to-speech (default: true)')
    .option('--no-tts', 'Disable text-to-speech')
    .option('--streaming-tts', 'Enable streaming TTS (default: true)')
    .option('--no-streaming-tts', 'Disable streaming (batch mode)')
    .option(
      '--yolo',
      'Bypass all permission checks (dangerous). Without --yolo, structured file-write tools (Write/Edit/MultiEdit) are path-clamped to the project root, but Bash/shell is not restricted — use Codex provider for full shell sandboxing.',
    )
    .configureHelp({ formatHelp: (cmd) => buildHelpText(cmd) })
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
  reasoningEffort: ReasoningEffort
  voice: Voice
  ttsMode: 'serve' | 'generate'
  ttsServerUrl?: string
  ttsSpeed: number
  resumeSession?: string
  claudeSession?: string
  codexThread?: string
  new?: boolean
  resume?: string
  skipIntro?: boolean
  tts?: boolean
  streamingTts?: boolean
  yolo?: boolean
}

interface ParseResult {
  config: AppConfig
  explicit: ExplicitFlags
  /**
   * Provider/model that were explicitly requested on this invocation's argv
   * (never from config-file defaults). `--provider`/`--model` have no Commander
   * defaults, so their presence here means the user typed them.
   */
  cliOverrides: {
    provider?: LlmProvider
    model?: string
  }
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
    resumeId: opts.resume?.trim() || undefined,
    skipIntro: isUserSet(program, 'skipIntro') ? opts.skipIntro === true : baseConfig.skipIntro,
    ttsEnabled: isUserSet(program, 'tts') ? opts.tts !== false : baseConfig.ttsEnabled,
    ttsStreamingEnabled: isUserSet(program, 'streamingTts')
      ? opts.streamingTts !== false
      : baseConfig.ttsStreamingEnabled,
    ttsSpeed: opts.ttsSpeed,
    ttsVoice: opts.voice,
    ttsMode: opts.ttsMode,
    llmReasoningEffort: opts.reasoningEffort,
    yolo: isUserSet(program, 'yolo') ? opts.yolo === true : baseConfig.yolo,
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

  const sessionOverride = parseSessionOverride(opts)
  assertSessionProviderMatches(sessionOverride, providerOverride, '--provider')
  assertSessionProviderMatches(sessionOverride, modelOverride?.provider, '--model')

  const providerBeforeResolution = config.llmProvider
  if (modelOverride?.provider) {
    config.llmProvider = modelOverride.provider
  } else if (providerOverride) {
    config.llmProvider = providerOverride
  } else if (sessionOverride) {
    config.llmProvider = sessionOverride.provider
  }

  if (modelOverride) {
    config.llmModel = resolveModelForConfig(config.llmProvider, modelOverride.id)
  } else if (providerOverride || providerBeforeResolution !== config.llmProvider) {
    config.llmModel = DEFAULT_MODEL_ALIAS_BY_PROVIDER[config.llmProvider]
  }
  config.resumeSession = sessionOverride?.session

  const explicit: ExplicitFlags = {
    provider:
      baseExplicit.provider === true ||
      isUserSet(program, 'provider') ||
      isUserSet(program, 'llmProvider') ||
      Boolean(modelOverride?.provider) ||
      Boolean(sessionOverride),
    model: baseExplicit.model === true || isUserSet(program, 'model'),
    ttsBufferSentences: baseExplicit.ttsBufferSentences === true,
    ttsMinChunkLength: baseExplicit.ttsMinChunkLength === true,
    ttsMaxWaitMs: baseExplicit.ttsMaxWaitMs === true,
    ttsGraceWindowMs: baseExplicit.ttsGraceWindowMs === true,
    ttsClauseBoundaries: baseExplicit.ttsClauseBoundaries === true,
  }

  return {
    config,
    explicit,
    cliOverrides: {
      provider: providerOverride ?? modelOverride?.provider ?? sessionOverride?.provider,
      model: modelOverride?.id,
    },
  }
}

export { DEFAULT_CONFIG, DEFAULT_MODEL_ALIAS_BY_PROVIDER, DEFAULT_MODEL_BY_PROVIDER }
