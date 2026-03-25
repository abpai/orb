import { afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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

      await runSetup({ configPath })

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
    await runSetupCommand([], { configPath })

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

      await runSetup({ configPath })

      expect(infoMessages.join('\n')).toContain('Generate mode uses macOS `say` and `afplay`')
    } finally {
      console.info = originalConsoleInfo
    }
  })
})
