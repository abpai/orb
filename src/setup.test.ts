import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirs: string[] = []
const originalStdinTty = process.stdin.isTTY
const originalStdoutTty = process.stdout.isTTY

function setTTY(enabled: boolean) {
  Object.defineProperty(process.stdin, 'isTTY', { value: enabled, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: enabled, configurable: true })
}

async function importSetupModule() {
  return await import('./setup')
}

afterEach(async () => {
  mock.restore()
  setTTY(Boolean(originalStdinTty && originalStdoutTty))
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('runSetup', () => {
  it('writes config.toml from prompted values', async () => {
    setTTY(true)
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.toml')
    const infoMessages: string[] = []
    const originalConsoleInfo = console.info
    console.info = (...args: unknown[]) => {
      infoMessages.push(args.join(' '))
    }

    try {
      const setupCalls = { select: 0, text: 0 }

      mock.module('@clack/prompts', () => ({
        intro: () => {},
        outro: () => {},
        cancel: () => {},
        isCancel: () => false,
        select: async (...args: unknown[]) => {
          const call = setupCalls.select++
          return call === 0 ? 'openai' : call === 1 ? 'serve' : 'jean'
        },
        confirm: async () => true,
        text: async (...args: unknown[]) => {
          const call = setupCalls.text++
          return call === 0 ? 'gpt-5.4-mini' : call === 1 ? 'http://voicebox.local:8000' : '1.75'
        },
      }))

      const { runSetup } = await importSetupModule()

      await runSetup({
        configPath,
        commandsSourceDir: join(tempDir, 'no-commands'),
        commandsTargetDir: join(tempDir, 'commands-target'),
      })

      const written = await readFile(configPath, 'utf8')
      expect(written).toContain('provider = "openai"')
      expect(written).toContain('model = "gpt-5.4-mini"')
      expect(written).toContain('skip_intro = true')
      expect(written).toContain('server_url = "http://voicebox.local:8000"')
      expect(written).toContain('voice = "jean"')
      expect(written).toContain('speed = 1.75')
      expect(infoMessages.join('\n')).toContain('uv tool install tts-gateway[kokoro]')
      expect(infoMessages.join('\n')).toContain('en_core_web_sm')
      expect(infoMessages.join('\n')).toContain('http://voicebox.local:8000')
    } finally {
      console.info = originalConsoleInfo
    }
  })

  it('does not write when the user cancels overwrite', async () => {
    setTTY(true)
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.toml')
    await Bun.write(configPath, 'provider = "anthropic"\n')
    const setupCalls = { select: 0, text: 0, confirm: 0 }

    mock.module('@clack/prompts', () => ({
      intro: () => {},
      outro: () => {},
      cancel: () => {},
      isCancel: () => false,
      select: async (...args: unknown[]) => {
        const call = setupCalls.select++
        return call === 0 ? 'anthropic' : call === 1 ? 'serve' : 'alba'
      },
      confirm: async () => {
        const call = setupCalls.confirm++
        return call < 3 ? true : false
      },
      text: async (...args: unknown[]) => {
        const call = setupCalls.text++
        return call === 0
          ? 'claude-haiku-4-5-20251001'
          : call === 1
            ? 'http://localhost:8000'
            : '1.5'
      },
    }))

    const { runSetup } = await importSetupModule()

    await runSetup({ configPath })

    const written = await readFile(configPath, 'utf8')
    expect(written).toBe('provider = "anthropic"\n')
  })

  it('throws if setup is run without a TTY', async () => {
    setTTY(false)
    mock.module('@clack/prompts', () => ({
      intro: () => {},
      outro: () => {},
      cancel: () => {},
      isCancel: () => false,
      select: async () => 'anthropic',
      confirm: async () => true,
      text: async () => 'value',
    }))

    const { runSetup } = await importSetupModule()
    await expect(runSetup({ configPath: join(tmpdir(), 'unused-config.toml') })).rejects.toThrow(
      'Interactive setup requires a TTY.',
    )
  })

  it('accepts setup command args before running the wizard', async () => {
    setTTY(true)
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.toml')
    const setupCalls = { text: 0 }

    mock.module('@clack/prompts', () => ({
      intro: () => {},
      outro: () => {},
      cancel: () => {},
      isCancel: () => false,
      select: async () => 'anthropic',
      confirm: async () => true,
      text: async (...args: unknown[]) => {
        const call = setupCalls.text++
        return call === 0
          ? 'claude-haiku-4-5-20251001'
          : call === 1
            ? 'http://localhost:8000'
            : '1.5'
      },
    }))

    const { runSetupCommand } = await importSetupModule()
    await runSetupCommand([], {
      configPath,
      commandsSourceDir: join(tempDir, 'no-commands'),
      commandsTargetDir: join(tempDir, 'commands-target'),
    })

    const written = await readFile(configPath, 'utf8')
    expect(written).toContain('provider = "anthropic"')
  })

  it('prints the macOS generate-mode note after saving config', async () => {
    setTTY(true)
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.toml')
    const infoMessages: string[] = []
    const originalConsoleInfo = console.info
    console.info = (...args: unknown[]) => {
      infoMessages.push(args.join(' '))
    }

    try {
      const setupCalls = { select: 0, text: 0 }

      mock.module('@clack/prompts', () => ({
        intro: () => {},
        outro: () => {},
        cancel: () => {},
        isCancel: () => false,
        select: async (...args: unknown[]) => {
          const call = setupCalls.select++
          return call === 0 ? 'anthropic' : call === 1 ? 'generate' : 'alba'
        },
        confirm: async () => true,
        text: async (...args: unknown[]) => {
          const call = setupCalls.text++
          return call === 0 ? 'claude-haiku-4-5-20251001' : '1.5'
        },
      }))

      const { runSetup } = await importSetupModule()

      await runSetup({
        configPath,
        commandsSourceDir: join(tempDir, 'no-commands'),
        commandsTargetDir: join(tempDir, 'commands-target'),
      })

      expect(infoMessages.join('\n')).toContain('Generate mode uses macOS `say` and `afplay`')
    } finally {
      console.info = originalConsoleInfo
    }
  })

  it('installs bundled default commands into the target directory', async () => {
    setTTY(true)
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.toml')
    const commandsSourceDir = join(tempDir, 'source-commands')
    const commandsTargetDir = join(tempDir, 'target-commands')
    await mkdir(commandsSourceDir, { recursive: true })
    await writeFile(join(commandsSourceDir, 'tour.md'), 'Bundled tour')
    await writeFile(join(commandsSourceDir, 'quiz.md'), 'Bundled quiz')

    const infoMessages: string[] = []
    const originalConsoleInfo = console.info
    console.info = (...args: unknown[]) => {
      infoMessages.push(args.join(' '))
    }

    try {
      const setupCalls = { select: 0, text: 0 }

      mock.module('@clack/prompts', () => ({
        intro: () => {},
        outro: () => {},
        cancel: () => {},
        isCancel: () => false,
        select: async () => {
          const call = setupCalls.select++
          return call === 0 ? 'anthropic' : call === 1 ? 'generate' : 'alba'
        },
        confirm: async () => true,
        text: async () => {
          const call = setupCalls.text++
          return call === 0 ? 'claude-haiku-4-5-20251001' : '1.5'
        },
      }))

      const { runSetup } = await importSetupModule()

      await runSetup({ configPath, commandsSourceDir, commandsTargetDir })

      expect(await readFile(join(commandsTargetDir, 'tour.md'), 'utf8')).toBe('Bundled tour')
      expect(await readFile(join(commandsTargetDir, 'quiz.md'), 'utf8')).toBe('Bundled quiz')
      const info = infoMessages.join('\n')
      expect(info).toContain('Installed 2 commands')
      expect(info).toContain('/tour')
      expect(info).toContain('/quiz')
    } finally {
      console.info = originalConsoleInfo
    }
  })

  it('skips installing defaults when the user declines', async () => {
    setTTY(true)
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.toml')
    const commandsSourceDir = join(tempDir, 'source-commands')
    const commandsTargetDir = join(tempDir, 'target-commands')
    await mkdir(commandsSourceDir, { recursive: true })
    await writeFile(join(commandsSourceDir, 'tour.md'), 'Bundled tour')

    const setupCalls = { select: 0, text: 0, confirm: 0 }

    mock.module('@clack/prompts', () => ({
      intro: () => {},
      outro: () => {},
      cancel: () => {},
      isCancel: () => false,
      select: async () => {
        const call = setupCalls.select++
        return call === 0 ? 'anthropic' : call === 1 ? 'generate' : 'alba'
      },
      confirm: async () => {
        const call = setupCalls.confirm++
        return call < 3
      },
      text: async () => {
        const call = setupCalls.text++
        return call === 0 ? 'claude-haiku-4-5-20251001' : '1.5'
      },
    }))

    const { runSetup } = await importSetupModule()

    await runSetup({ configPath, commandsSourceDir, commandsTargetDir })

    await expect(readFile(join(commandsTargetDir, 'tour.md'), 'utf8')).rejects.toThrow()
  })

  it('treats canceling the default-command prompt as a non-fatal skip after save', async () => {
    setTTY(true)
    const tempDir = await mkdtemp(join(tmpdir(), 'orb-setup-'))
    tempDirs.push(tempDir)
    const configPath = join(tempDir, 'config.toml')
    const commandsSourceDir = join(tempDir, 'source-commands')
    const commandsTargetDir = join(tempDir, 'target-commands')
    const canceled = Symbol('cancel')
    await mkdir(commandsSourceDir, { recursive: true })
    await writeFile(join(commandsSourceDir, 'tour.md'), 'Bundled tour')

    const setupCalls = { select: 0, text: 0, confirm: 0 }

    mock.module('@clack/prompts', () => ({
      intro: () => {},
      outro: () => {},
      cancel: () => {},
      isCancel: (value: unknown) => value === canceled,
      select: async () => {
        const call = setupCalls.select++
        return call === 0 ? 'anthropic' : call === 1 ? 'generate' : 'alba'
      },
      confirm: async () => {
        const call = setupCalls.confirm++
        return call < 3 ? true : canceled
      },
      text: async () => {
        const call = setupCalls.text++
        return call === 0 ? 'claude-haiku-4-5-20251001' : '1.5'
      },
    }))

    const { runSetup } = await importSetupModule()

    await expect(runSetup({ configPath, commandsSourceDir, commandsTargetDir })).resolves.toBe(
      undefined,
    )
    expect(await readFile(configPath, 'utf8')).toContain('provider = "anthropic"')
    await expect(readFile(join(commandsTargetDir, 'tour.md'), 'utf8')).rejects.toThrow()
  })
})
