import { buildProviderPrompt } from '../../services/prompts'
import type { AgentSession, AppConfig } from '../../types'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { AgentAdapter, AgentAdapterConfig } from './types'
import { createToolFrameTracker, formatToolResult, normalizeToolInput } from './utils'

interface CursorAgentCommandOptions {
  appConfig: AppConfig
  prompt: string
  session?: AgentSession
  binary?: string
}

interface CursorStreamStep {
  frames: Frame[]
  completed?: boolean
  error?: Error
}

interface CursorToolDescription {
  id: string
  name: string
  input: Record<string, unknown>
  result: string
  isError: boolean
}

const CURSOR_TOOL_SUFFIX = 'ToolCall'
const CURSOR_AGENT_BINARIES = ['agent', 'cursor-agent'] as const
const CURSOR_AUTH_HINT =
  'Run `agent login` (or `cursor-agent login`) for browser auth, or set CURSOR_API_KEY for unattended runs.'

export function formatCursorPrompt(instructions: string, prompt: string): string {
  return `${instructions.trim()}\n\n---\n\nUser request:\n${prompt}`.trim()
}

export function buildCursorAgentCommand({
  appConfig,
  prompt,
  session,
  binary = 'agent',
}: CursorAgentCommandOptions): string[] {
  const cmd = [
    binary,
    '-p',
    '--trust',
    '--workspace',
    appConfig.projectPath,
    '--model',
    appConfig.llmModel,
    '--output-format',
    'stream-json',
    '--stream-partial-output',
  ]

  if (appConfig.yolo) {
    cmd.push('--force', '--approve-mcps')
  } else {
    cmd.push('--mode', 'ask')
  }

  if (session?.provider === 'cursor') {
    cmd.push('--resume', session.sessionId)
  }

  cmd.push(prompt)
  return cmd
}

export function resolveCursorAgentBinary(
  which: (binary: string) => string | null | undefined = (binary) => Bun.which(binary),
): string | null {
  for (const binary of CURSOR_AGENT_BINARIES) {
    if (which(binary)) return binary
  }

  return null
}

function redactSecrets(value: string): string {
  return value
    .replace(/(CURSOR_API_KEY=)[^\s]+/gi, '$1[redacted]')
    .replace(/(api[-_ ]?key[:=]\s*)[^\s]+/gi, '$1[redacted]')
    .replace(/(crsr_[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1...')
    .replace(/(sk-[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1...')
}

function looksLikeCursorAuthFailure(value: string): boolean {
  return /\b(auth|authenticated|authentication|login|sign[ -]?in|unauthorized|api[-_ ]?key)\b/i.test(
    value,
  )
}

function withStderr(message: string, stderr: string): string {
  const redacted = redactSecrets(stderr).trim()
  const fullMessage = redacted ? `${message}: ${redacted}` : message
  return looksLikeCursorAuthFailure(fullMessage) && !fullMessage.includes(CURSOR_AUTH_HINT)
    ? `${fullMessage}\n${CURSOR_AUTH_HINT}`
    : fullMessage
}

function cursorAbortError(): Error {
  if (typeof globalThis.DOMException !== 'undefined') {
    return new globalThis.DOMException('Cursor Agent run aborted', 'AbortError')
  }
  const error = new Error('Cursor Agent run aborted')
  error.name = 'AbortError'
  return error
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function textFromMessage(message: unknown): string {
  const content = asObject(message)?.content
  if (!Array.isArray(content)) return ''

  return content
    .map((block) => {
      const typed = asObject(block)
      return typed?.type === 'text' && typeof typed.text === 'string' ? typed.text : ''
    })
    .join('')
}

function findToolPayload(
  toolCall: unknown,
): { key: string; value: Record<string, unknown> } | null {
  const root = asObject(toolCall)
  if (!root) return null

  for (const [key, value] of Object.entries(root)) {
    if (!key.endsWith(CURSOR_TOOL_SUFFIX)) continue
    const payload = asObject(value)
    if (payload) return { key, value: payload }
  }

  return null
}

function toolNameFromKey(key: string): string {
  const withoutSuffix = key.slice(0, -CURSOR_TOOL_SUFFIX.length)
  return withoutSuffix || 'cursor-tool'
}

function formatCursorToolResult(value: unknown): string {
  const result = asObject(value)
  const success = asObject(result?.success)
  const failure = asObject(result?.error)

  const successMessage = asString(success?.message)
  if (successMessage) return successMessage

  const failureMessage = asString(failure?.message)
  if (failureMessage) return failureMessage

  return formatToolResult(value)
}

function describeCursorTool(event: Record<string, unknown>): CursorToolDescription | null {
  const id = asString(event.call_id)
  const toolCall = asObject(event.tool_call)
  const payload = findToolPayload(toolCall)
  if (!id || !payload) return null

  const result = asObject(payload.value.result)
  return {
    id,
    name: toolNameFromKey(payload.key),
    input: normalizeToolInput(payload.value.args),
    result: result ? formatCursorToolResult(result) : '',
    isError: Boolean(result?.error),
  }
}

function resultText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return formatToolResult(value)
}

export function createCursorStreamMapper() {
  const tools = createToolFrameTracker()
  let accumulatedText = ''
  let latestSessionId: string | undefined

  function appendText(text: string): Frame[] {
    if (!text) return []

    let delta = text
    let next = accumulatedText + text

    if (text === accumulatedText) {
      delta = ''
      next = accumulatedText
    } else if (text.startsWith(accumulatedText)) {
      delta = text.slice(accumulatedText.length)
      next = text
    }

    if (!delta) {
      accumulatedText = next
      return []
    }

    accumulatedText = next
    return [createFrame('agent-text-delta', { delta, accumulatedText })]
  }

  function sessionFrame(sessionId: string | undefined): Frame[] {
    if (!sessionId || sessionId === latestSessionId) return []
    latestSessionId = sessionId
    return [createFrame('agent-session', { session: { provider: 'cursor', sessionId } })]
  }

  return {
    handleLine(line: string): CursorStreamStep {
      let event: Record<string, unknown>
      try {
        const parsed = JSON.parse(line) as unknown
        const object = asObject(parsed)
        if (!object) throw new Error('event was not an object')
        event = object
      } catch (error) {
        return {
          frames: [],
          error: new Error(
            `Cursor Agent emitted invalid JSON (${error instanceof Error ? error.message : String(error)})`,
          ),
        }
      }

      const frames = sessionFrame(asString(event.session_id))
      const type = event.type

      if (type === 'assistant') {
        frames.push(...appendText(textFromMessage(event.message)))
        return { frames }
      }

      if (type === 'tool_call') {
        const tool = describeCursorTool(event)
        if (!tool) return { frames }

        if (event.subtype === 'started') {
          frames.push(tools.start({ id: tool.id, name: tool.name, input: tool.input }))
        } else if (event.subtype === 'completed') {
          frames.push(...tools.result(tool.id, tool.result, tool.isError, tool.name))
        }

        return { frames }
      }

      if (type === 'result') {
        if (event.is_error === true || event.subtype !== 'success') {
          return {
            frames,
            error: new Error(resultText(event.result) || 'Cursor Agent turn failed.'),
          }
        }

        frames.push(
          createFrame('agent-text-complete', {
            text: resultText(event.result) || accumulatedText,
          }),
        )
        return { frames, completed: true }
      }

      return { frames }
    },
  }
}

async function* cursorEventFrames(
  proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
  signal: AbortSignal,
): AsyncGenerator<Frame> {
  const mapper = createCursorStreamMapper()
  const stderrPromise = new Response(proc.stderr).text()
  const decoder = new TextDecoder()
  const reader = proc.stdout.getReader()
  let buffer = ''
  let completed = false
  let aborted = false
  let parseOrTurnError: Error | undefined

  const onAbort = () => {
    aborted = true
    try {
      proc.kill()
    } catch {
      // The process may have already exited.
    }
  }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (value) {
        buffer += decoder.decode(value, { stream: !done })
      }

      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (line) {
          const step = mapper.handleLine(line)
          if (step.error) {
            parseOrTurnError = step.error
            proc.kill()
            break
          }
          completed = completed || step.completed === true
          yield* step.frames
        }
        newlineIndex = buffer.indexOf('\n')
      }

      if (parseOrTurnError || done) break
    }

    const tail = `${buffer}${decoder.decode()}`.trim()
    if (!parseOrTurnError && tail) {
      const step = mapper.handleLine(tail)
      if (step.error) {
        parseOrTurnError = step.error
        proc.kill()
      } else {
        completed = completed || step.completed === true
        yield* step.frames
      }
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }

  const [stderr, exitCode] = await Promise.all([stderrPromise, proc.exited])
  if (aborted || signal.aborted) throw cursorAbortError()
  if (parseOrTurnError) throw new Error(withStderr(parseOrTurnError.message, stderr))
  if (exitCode !== 0)
    throw new Error(withStderr(`Cursor Agent exited with code ${exitCode}`, stderr))
  if (!completed) {
    throw new Error(withStderr('Cursor Agent exited before completing the turn', stderr))
  }
}

export function createCursorAdapter(config: AgentAdapterConfig): AgentAdapter {
  return {
    async *stream(prompt: string): AsyncIterable<Frame> {
      const { appConfig, session, abortController } = config
      const binary = resolveCursorAgentBinary()
      if (!binary) {
        throw new Error(
          'Cursor provider requires the Cursor Agent CLI (`agent` or `cursor-agent`) on PATH. Run `agent login` (or `cursor-agent login`) after installing Cursor Agent.',
        )
      }

      const instructions = await buildProviderPrompt({
        provider: 'cursor',
        projectPath: appConfig.projectPath,
        ttsEnabled: appConfig.ttsEnabled,
      })
      const fullPrompt = formatCursorPrompt(instructions, prompt)
      const cmd = buildCursorAgentCommand({ appConfig, prompt: fullPrompt, session, binary })
      const proc = Bun.spawn({
        cmd,
        cwd: appConfig.projectPath,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })

      yield* cursorEventFrames(proc, abortController.signal)
    },
  }
}
