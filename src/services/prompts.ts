import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { LlmProvider } from '../types'

const PROMPTS_DIR = join(import.meta.dir, '..', '..', 'prompts')

const PROVIDER_PROMPT_FILES: Record<LlmProvider, string> = {
  anthropic: 'anthropic.md',
  openai: 'openai.md',
}

const VOICE_PROMPT_FILE = 'voice.md'

interface PromptTemplateValues {
  projectName: string
  projectPath: string
}

export interface PromptBuildOptions {
  provider: LlmProvider
  projectPath: string
  ttsEnabled: boolean
  promptsDir?: string
}

function getPromptTemplateValues(projectPath: string): PromptTemplateValues {
  return {
    projectName: basename(projectPath) || projectPath,
    projectPath,
  }
}

function interpolatePrompt(template: string, values: PromptTemplateValues): string {
  return template
    .replaceAll('{{projectName}}', values.projectName)
    .replaceAll('{{projectPath}}', values.projectPath)
}

async function readPromptFile(
  promptsDir: string,
  fileName: string,
  values: PromptTemplateValues,
): Promise<string> {
  const filePath = join(promptsDir, fileName)

  try {
    const contents = await readFile(filePath, 'utf8')
    return interpolatePrompt(contents.trim(), values)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Missing prompt file: ${filePath}`)
    }
    throw new Error(
      `Failed to read prompt file "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function buildProviderPrompt({
  provider,
  projectPath,
  ttsEnabled,
  promptsDir = PROMPTS_DIR,
}: PromptBuildOptions): Promise<string> {
  const values = getPromptTemplateValues(projectPath)
  const fileNames = [
    'base.md',
    PROVIDER_PROMPT_FILES[provider],
    ...(ttsEnabled ? [VOICE_PROMPT_FILE] : []),
  ]
  const sections = await Promise.all(
    fileNames.map((fileName) => readPromptFile(promptsDir, fileName, values)),
  )

  return sections.filter(Boolean).join('\n\n').trim()
}
