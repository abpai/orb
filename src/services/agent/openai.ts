import { createBashTool } from 'bash-tool'
import { ToolLoopAgent, stepCountIs, type ToolSet, type StepResult } from 'ai'
import type { AgentSession, AppConfig, OpenAiMessage } from '../../types'
import { VOICE_SYSTEM_PROMPT, type AgentCallbacks, type AgentRunResult } from './types'
import { resolveOpenAiProvider, validateCodexModel } from '../openai-auth'

interface ToolCall {
  toolCallId: string
  toolName: string
  input: unknown
}

interface ToolResult {
  toolCallId: string
  toolName: string
  output: unknown
}

const BASE_INSTRUCTIONS = `You are a helpful coding assistant.

The project is mounted at /workspace.
Use the provided bash, readFile, and writeFile tools to explore or edit files.
Edits happen in a sandbox overlay; describe any changes you make.
Never claim to be Claude or Anthropic; you are an OpenAI model.
Prefer concise bash commands (ls, rg, sed, awk, jq) and keep outputs short.
If you need to modify files, do so via writeFile so changes are explicit.`

function buildConversationPrompt(messages: OpenAiMessage[]): string {
  return messages
    .map((message) => {
      const label = message.role === 'user' ? 'User' : 'Assistant'
      return `${label}: ${message.content}`
    })
    .join('\n\n')
}

function normalizeToolInput(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'object') return value as Record<string, unknown>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>
      }
    } catch {
      return { value }
    }
  }
  return { value }
}

function isToolError(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const typed = value as Record<string, unknown>
  if (typed.isError === true || typed.is_error === true) return true
  if (typeof typed.exitCode === 'number' && typed.exitCode !== 0) return true
  if (typeof typed.success === 'boolean' && typed.success === false) return true
  if (typed.error instanceof Error) return true
  if (typeof typed.error === 'string' && typed.error.length > 0) return true
  return false
}

function formatToolResult(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return String(value ?? '')

  const typed = value as Record<string, unknown>

  // Prefer stdout/stderr for bash-like results
  const stdout = typeof typed.stdout === 'string' ? typed.stdout : ''
  const stderr = typeof typed.stderr === 'string' ? typed.stderr : ''
  if (stdout || stderr) return [stdout, stderr].filter(Boolean).join('\n').trim()

  // Common result properties
  if (typeof typed.content === 'string') return typed.content
  if (typeof typed.result === 'string') return typed.result
  if (typeof typed.success === 'boolean') return typed.success ? 'success' : 'error'

  // Fallback to JSON
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export async function runOpenAiAgent(
  prompt: string,
  config: AppConfig,
  session: AgentSession | undefined,
  callbacks: AgentCallbacks,
  abortController?: AbortController,
): Promise<AgentRunResult> {
  const priorMessages = session?.provider === 'openai' ? session.messages : []
  const nextMessages: OpenAiMessage[] = [...priorMessages, { role: 'user', content: prompt }]
  const conversationPrompt = buildConversationPrompt(nextMessages)
  const instructions = config.ttsEnabled
    ? `${BASE_INSTRUCTIONS}\n\n${VOICE_SYSTEM_PROMPT}`
    : BASE_INSTRUCTIONS

  const { tools, sandbox } = await createBashTool({
    uploadDirectory: {
      source: config.projectPath,
      include: '**/*',
    },
    maxFiles: 5000,
  })

  const { bash, readFile, writeFile } = tools
  const allowedTools: ToolSet = { bash, readFile, writeFile }

  let assistantText = ''
  let toolIndex = 0
  const toolIdToIndex = new Map<string, number>()

  function getOrCreateIndex(toolId: string): number {
    const existing = toolIdToIndex.get(toolId)
    if (existing !== undefined) return existing
    const index = toolIndex++
    toolIdToIndex.set(toolId, index)
    return index
  }

  function registerToolCall(call: ToolCall): void {
    const index = getOrCreateIndex(call.toolCallId)

    callbacks.onToolCall?.({
      id: call.toolCallId,
      index,
      name: call.toolName,
      input: normalizeToolInput(call.input),
      status: 'running',
    })
  }

  function registerToolResult(result: ToolResult): void {
    const existingIndex = toolIdToIndex.get(result.toolCallId)
    const index = getOrCreateIndex(result.toolCallId)

    if (existingIndex === undefined) {
      callbacks.onToolCall?.({
        id: result.toolCallId,
        index,
        name: result.toolName,
        input: {},
        status: 'running',
      })
    }

    const text = formatToolResult(result.output)
    const callback = isToolError(result.output) ? callbacks.onToolError : callbacks.onToolResult
    callback?.(index, text)
  }

  const { provider, source: authSource } = await resolveOpenAiProvider(config)

  // Validate model when using ChatGPT OAuth (Codex endpoint has model restrictions)
  if (authSource === 'chatgpt') {
    validateCodexModel(config.llmModel)
  }

  // Codex endpoint requires chat API for proper tool calling support
  const effectiveApi = authSource === 'chatgpt' ? 'chat' : config.openaiApi

  const buildModel = (api: 'responses' | 'chat') =>
    api === 'chat'
      ? provider.chat(config.llmModel as never)
      : provider.responses(config.llmModel as never)

  const runStream = async (api: 'responses' | 'chat') => {
    assistantText = ''
    toolIndex = 0
    toolIdToIndex.clear()

    const agent = new ToolLoopAgent({
      model: buildModel(api),
      instructions,
      tools: allowedTools,
      stopWhen: stepCountIs(20),
    })

    const stream = await agent.stream({
      prompt: conversationPrompt,
      onStepFinish: (stepResult: StepResult<ToolSet>) => {
        for (const call of stepResult.toolCalls) {
          registerToolCall(call)
        }
        for (const result of stepResult.toolResults) {
          registerToolResult(result)
        }
      },
      abortSignal: abortController?.signal,
    })

    for await (const chunk of stream.textStream) {
      assistantText += chunk
      callbacks.onAssistantText?.(chunk)
    }
  }

  try {
    await runStream(effectiveApi)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const canFallback = effectiveApi === 'responses' && message.includes('api.responses.write')
    if (!canFallback) {
      throw err
    }
    console.warn(
      'OpenAI responses scope missing. Falling back to chat completions. Pass --openai-api=chat to skip this warning.',
    )
    await runStream('chat')
  } finally {
    if ('stop' in sandbox && typeof sandbox.stop === 'function') {
      await (sandbox.stop as () => Promise<void>)().catch(() => {})
    }
  }

  const updatedMessages: OpenAiMessage[] = [
    ...nextMessages,
    { role: 'assistant', content: assistantText },
  ]

  return {
    text: assistantText,
    session: { provider: 'openai', messages: updatedMessages },
  }
}
