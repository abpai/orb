import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildProviderPrompt } from './prompts'

const tempDirs: string[] = []

async function createPromptsDir(files: Record<string, string>): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'orb-prompts-'))
  const promptsDir = join(rootDir, 'prompts')
  tempDirs.push(rootDir)

  await mkdir(promptsDir, { recursive: true })
  for (const [fileName, contents] of Object.entries(files)) {
    await writeFile(join(promptsDir, fileName), contents)
  }

  return promptsDir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('buildProviderPrompt', () => {
  it('composes shared and anthropic prompt sections with project values', async () => {
    const promptsDir = await createPromptsDir({
      'base.md': 'You are a helpful coding assistant.',
      'anthropic.md': 'The current project is "{{projectName}}" at {{projectPath}}.',
      'voice.md': 'Voice mode is enabled.',
    })

    const prompt = await buildProviderPrompt({
      provider: 'anthropic',
      projectPath: '/tmp/orb-demo',
      ttsEnabled: false,
      promptsDir,
    })

    expect(prompt).toContain('You are a helpful coding assistant.')
    expect(prompt).toContain('The current project is "orb-demo" at /tmp/orb-demo.')
    expect(prompt).not.toContain('Voice mode is enabled.')
  })

  it('adds voice guidance when TTS is enabled', async () => {
    const promptsDir = await createPromptsDir({
      'base.md': 'Base prompt.',
      'openai.md': 'OpenAI prompt.',
      'voice.md': 'Voice prompt.',
    })

    const prompt = await buildProviderPrompt({
      provider: 'openai',
      projectPath: '/tmp/orb-demo',
      ttsEnabled: true,
      promptsDir,
    })

    expect(prompt).toBe('Base prompt.\n\nOpenAI prompt.\n\nVoice prompt.')
  })

  it('throws a clear error when a required prompt file is missing', async () => {
    const promptsDir = await createPromptsDir({
      'base.md': 'Base prompt.',
      'voice.md': 'Voice prompt.',
    })

    await expect(
      buildProviderPrompt({
        provider: 'openai',
        projectPath: '/tmp/orb-demo',
        ttsEnabled: false,
        promptsDir,
      }),
    ).rejects.toThrow(`Missing prompt file: ${join(promptsDir, 'openai.md')}`)
  })
})
