import React from 'react'
import { basename } from 'path'
import { render } from 'ink'
import { App } from './ui/App'
import { parseCliArgs } from './config'
import { loadSession } from './services/session'

export { App } from './ui/App'
export { parseCliArgs, DEFAULT_CONFIG } from './config'
export type { AppConfig, Model, Voice } from './types'

const MAX_CONTENT_WIDTH = 56

function formatLine(label: string, value: string): string {
  const prefix = `${label}: `
  const available = Math.max(0, MAX_CONTENT_WIDTH - prefix.length)
  if (value.length > available && available > 1) {
    return `${prefix}\u2026${value.slice(value.length - (available - 1))}`
  }
  return `${prefix}${value.slice(0, available)}`
}

function padCenter(value: string, width: number): string {
  if (value.length >= width) return value
  const totalPad = width - value.length
  const left = Math.floor(totalPad / 2)
  const right = totalPad - left
  return `${' '.repeat(left)}${value}${' '.repeat(right)}`
}

function showHelp(): void {
  console.info(`
vibe-claude - Voice-Driven Code Explorer

Usage: vibe-claude [projectPath] [options]

Options:
  --voice=<voice>    TTS voice: alba, marius, jean (default: alba)
  --tts-mode=<mode>  TTS mode: generate, serve (default: serve)
  --tts-server-url=<url>  Pocket TTS server URL (implies serve, default: http://localhost:8000)
  --tts-speed=<rate> TTS speed multiplier (default: 1.5)
  --tts-buffer-sentences=<count>  Sentences to buffer before playback (default: 1)
  --tts-clause-boundaries  Enable comma/semicolon/colon split points
  --tts-min-chunk-length=<count>  Minimum chars before soft flush (default: 15)
  --tts-max-wait-ms=<ms>  Max latency before forcing a flush (default: 150)
  --tts-grace-window-ms=<ms>  Extra wait when near a boundary (default: 50)
  --model=<model>    Model: haiku, sonnet, opus (default: haiku)
  --new              Start fresh (ignore saved session)
  --no-tts           Disable text-to-speech
  --no-streaming-tts Disable streaming (batch mode)
  --help             Show this help message

Examples:
  vibe-claude                           # Current directory with defaults
  vibe-claude /path/to/project          # Specific project
  vibe-claude --voice=marius

Controls:
  - Type your question and press Enter
  - Paste MacWhisper transcription with Cmd+V
  - Shift+Tab to cycle models
  - Ctrl+C to exit
`)
}

export async function run(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    showHelp()
    process.exit(0)
  }

  const config = parseCliArgs(args)
  const initialSession = config.startFresh ? null : await loadSession(config.projectPath)
  const modelLabel = initialSession?.model ?? config.model
  const ttsModeLabel = config.ttsMode === 'serve' ? 'server' : 'generate'
  const ttsLabel = config.ttsEnabled
    ? `${config.ttsVoice}, ${ttsModeLabel}, x${config.ttsSpeed}`
    : 'Disabled'
  const projectName = basename(config.projectPath) || config.projectPath

  const infoLines = [
    formatLine('Project', projectName),
    formatLine('Path', config.projectPath),
    formatLine('Model', modelLabel),
    formatLine('TTS', ttsLabel),
  ]

  if (config.ttsEnabled && config.ttsMode === 'serve') {
    infoLines.push(formatLine('TTS URL', config.ttsServerUrl || 'http://localhost:8000'))
  }

  const contentWidth = Math.max('vibe-claude'.length, ...infoLines.map((line) => line.length))
  const topBorder = `╭${'─'.repeat(contentWidth + 2)}╮`
  const bottomBorder = `╰${'─'.repeat(contentWidth + 2)}╯`
  const titleLine = `│ ${padCenter('vibe-claude', contentWidth)} │`
  const spacerLine = `│ ${' '.repeat(contentWidth)} │`
  const detailLines = infoLines.map((line) => `│ ${line.padEnd(contentWidth)} │`)

  console.info(`
${topBorder}
${titleLine}
${spacerLine}
${detailLines.join('\n')}
${bottomBorder}
`)

  render(React.createElement(App, { config, initialSession }), {
    patchConsole: true,
  })
}
