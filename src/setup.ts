import { cancel, confirm, intro, isCancel, outro, select, text } from '@clack/prompts'
import { Command } from 'commander'
import {
  getGlobalConfigPath,
  loadGlobalConfig,
  writeGlobalConfig,
  type OrbGlobalConfig,
} from './services/global-config'
import {
  installDefaultCommands,
  listBundledDefaultCommands,
  type InstallDefaultCommandsResult,
} from './services/default-commands'
import { DEFAULT_MODEL_BY_PROVIDER } from './config'
import { VOICES, type LlmProvider, type Voice } from './types'

const SETUP_CANCELED = 'Setup canceled.'
const KOKORO_SPACY_INSTALL =
  '~/.local/share/uv/tools/tts-gateway/bin/python -m spacy download en_core_web_sm'

interface RunSetupOptions {
  configPath?: string
  commandsSourceDir?: string
  commandsTargetDir?: string
}

function ensureInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive setup requires a TTY.')
  }
}

function throwIfCanceled<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel(SETUP_CANCELED)
    throw new Error(SETUP_CANCELED)
  }

  return value
}

async function promptText(args: {
  message: string
  initialValue?: string
  placeholder?: string
  validate?: (value: string) => string | undefined
}): Promise<string> {
  const value = await text({
    message: args.message,
    initialValue: args.initialValue,
    placeholder: args.placeholder,
    validate: args.validate ? (raw) => args.validate?.((raw ?? '').toString().trim()) : undefined,
  })

  return String(throwIfCanceled(value)).trim()
}

function defaultModelFor(provider: LlmProvider, current?: string): string {
  if (!current?.trim()) return DEFAULT_MODEL_BY_PROVIDER[provider]
  return current
}

function mergeSetupConfig(base: OrbGlobalConfig, updates: OrbGlobalConfig): OrbGlobalConfig {
  return {
    ...base,
    ...updates,
    tts: {
      ...base.tts,
      ...updates.tts,
    },
  }
}

function printTtsSetupNextSteps(config: OrbGlobalConfig): void {
  if (!config.tts?.enabled) return

  console.info('')

  if (config.tts.mode === 'generate') {
    console.info('Generate mode uses macOS `say` and `afplay`; no tts-gateway server is required.')
    return
  }

  const serverUrl = config.tts.serverUrl ?? 'http://localhost:8000'

  console.info('Serve mode quick start:')
  console.info('  uv tool install tts-gateway[kokoro]')
  console.info('  # Required once for Kokoro inside uv tool environments')
  console.info(`  ${KOKORO_SPACY_INSTALL}`)
  console.info('  tts serve --provider kokoro --port 8000')
  console.info(`Orb will send speech requests to ${serverUrl}.`)
  console.info('Streaming playback prefers mpv or ffplay when available.')
  console.info('Use --tts-server-url or tts.server_url if your gateway runs elsewhere.')
}

export async function runSetup(options: RunSetupOptions = {}): Promise<void> {
  ensureInteractiveTerminal()

  const configPath = options.configPath ?? getGlobalConfigPath()
  const existing = await loadGlobalConfig(configPath)
  for (const warning of existing.warnings) {
    console.warn(`[orb] ${warning}`)
  }

  const current = existing.config
  const currentProvider = current.provider ?? 'anthropic'
  const currentModel = defaultModelFor(currentProvider, current.model)

  intro('orb setup')
  console.info(`Orb will save your defaults to ${configPath}.`)

  const provider = throwIfCanceled(
    await select({
      message: 'Default provider',
      initialValue: currentProvider,
      options: [
        { value: 'anthropic', label: 'Anthropic' },
        { value: 'openai', label: 'OpenAI' },
      ],
    }),
  ) as LlmProvider

  const model = await promptText({
    message: 'Default model',
    initialValue:
      current.provider === provider ? currentModel : DEFAULT_MODEL_BY_PROVIDER[provider],
    validate: (value) => (value.length === 0 ? 'Model is required.' : undefined),
  })

  const skipIntro = throwIfCanceled(
    await confirm({
      message: 'Skip the welcome animation by default?',
      initialValue: current.skipIntro ?? false,
    }),
  ) as boolean

  const ttsEnabled = throwIfCanceled(
    await confirm({
      message: 'Enable text-to-speech by default?',
      initialValue: current.tts?.enabled ?? true,
    }),
  ) as boolean

  const streamingEnabled = throwIfCanceled(
    await confirm({
      message: 'Enable streaming TTS by default?',
      initialValue: current.tts?.streaming ?? true,
    }),
  ) as boolean

  const ttsMode = throwIfCanceled(
    await select({
      message: 'Default TTS mode',
      initialValue: current.tts?.mode ?? 'serve',
      options: [
        { value: 'serve', label: 'Serve (HTTP TTS server)' },
        { value: 'generate', label: 'Generate (local macOS say fallback)' },
      ],
    }),
  ) as 'serve' | 'generate'

  const serverUrl =
    ttsMode === 'serve'
      ? await promptText({
          message: 'Default TTS server URL',
          initialValue: current.tts?.serverUrl ?? 'http://localhost:8000',
          validate: (value) =>
            value.length === 0 ? 'Server URL is required in serve mode.' : undefined,
        })
      : undefined

  const voice = throwIfCanceled(
    await select({
      message: 'Default voice',
      initialValue: current.tts?.voice ?? 'alba',
      options: VOICES.map((value) => ({ value, label: value })),
    }),
  ) as Voice

  const speedRaw = await promptText({
    message: 'Default speech speed',
    initialValue: String(current.tts?.speed ?? 1.5),
    validate: (value) => {
      const num = Number(value)
      return Number.isFinite(num) && num > 0 ? undefined : 'Enter a positive number.'
    },
  })

  const nextConfig = mergeSetupConfig(current, {
    provider,
    model,
    skipIntro,
    tts: {
      enabled: ttsEnabled,
      streaming: streamingEnabled,
      mode: ttsMode,
      serverUrl: serverUrl ?? current.tts?.serverUrl,
      voice,
      speed: Number(speedRaw),
    },
  })

  if (ttsMode !== 'serve' && nextConfig.tts) {
    delete nextConfig.tts.serverUrl
  }

  if (existing.exists) {
    const shouldWrite = throwIfCanceled(
      await confirm({
        message: `Overwrite ${configPath}?`,
        initialValue: true,
      }),
    ) as boolean

    if (!shouldWrite) {
      outro('No changes made.')
      return
    }
  }

  await writeGlobalConfig(nextConfig, configPath)
  outro(`Saved config to ${configPath}`)
  printTtsSetupNextSteps(nextConfig)
  await promptInstallDefaultCommands({
    sourceDir: options.commandsSourceDir,
    targetDir: options.commandsTargetDir,
  })
}

async function promptInstallDefaultCommands(options: {
  sourceDir?: string
  targetDir?: string
}): Promise<void> {
  const defaults = await listBundledDefaultCommands(options.sourceDir)
  if (defaults.length === 0) return

  const commandList = defaults.map((command) => `/${command.name}`).join(', ')
  const installChoice = await confirm({
    message: `Install ${defaults.length} default slash command${
      defaults.length === 1 ? '' : 's'
    } (${commandList}) to your global commands directory?`,
    initialValue: true,
  })
  if (isCancel(installChoice)) return

  const shouldInstall = installChoice as boolean

  if (!shouldInstall) return

  const result = await installDefaultCommands({
    sourceDir: options.sourceDir,
    targetDir: options.targetDir,
  })
  printInstallResult(result)
}

function printInstallResult(result: InstallDefaultCommandsResult): void {
  console.info('')
  if (result.installed.length > 0) {
    console.info(
      `Installed ${result.installed.length} command${
        result.installed.length === 1 ? '' : 's'
      } to ${result.targetDir}: ${result.installed.map((name) => `/${name}`).join(', ')}`,
    )
  }
  if (result.skipped.length > 0) {
    console.info(
      `Skipped ${result.skipped.length} existing command${
        result.skipped.length === 1 ? '' : 's'
      }: ${result.skipped.map((name) => `/${name}`).join(', ')}`,
    )
  }
  if (result.installed.length === 0 && result.skipped.length === 0) {
    console.info('No default commands to install.')
  }
}

export async function runSetupCommand(
  args: string[],
  options: RunSetupOptions = {},
): Promise<void> {
  const program = new Command()
    .name('orb setup')
    .description('Create or update ~/.orb/config.toml')
    .exitOverride()
    .allowExcessArguments(false)
    .configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
    })

  program.parse(args, { from: 'user' })
  await runSetup(options)
}
