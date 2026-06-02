import { buildProviderPrompt } from '../../services/prompts'
import { ORB_VERSION } from '../../config'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import { CodexAppServerClient } from './codex-client'
import { createToolFrameTracker } from './utils'
import type { AgentAdapter, AgentAdapterConfig } from './types'

interface ThreadItem {
  id: string
  type: string
  [key: string]: unknown
}

interface ThreadResponse {
  thread?: { id?: string }
}

interface TurnResponse {
  turn?: { id?: string; status?: string; error?: unknown }
}

interface AgentMessageAccumulator {
  text: string
  itemId: string | null
}

export function createOpenAiAgentMessageAccumulator(): AgentMessageAccumulator {
  return { text: '', itemId: null }
}

export function appendOpenAiAgentMessageDelta(
  accumulator: AgentMessageAccumulator,
  params: { itemId?: string; delta?: string },
): { delta: string; accumulatedText: string } {
  const delta = params.delta ?? ''
  if (!delta) return { delta: '', accumulatedText: accumulator.text }

  const isNewMessage =
    params.itemId !== undefined &&
    accumulator.itemId !== null &&
    params.itemId !== accumulator.itemId
  const needsParagraphBreak =
    isNewMessage &&
    accumulator.text.trimEnd().length > 0 &&
    delta.trimStart().length > 0 &&
    !/\n\s*\n$/.test(accumulator.text) &&
    !/^\s*\n/.test(delta)
  const renderedDelta = `${needsParagraphBreak ? '\n\n' : ''}${delta}`

  accumulator.text += renderedDelta
  if (params.itemId !== undefined) {
    accumulator.itemId = params.itemId
  }

  return { delta: renderedDelta, accumulatedText: accumulator.text }
}

function requireThreadId(response: unknown): string {
  const threadId = (response as ThreadResponse | undefined)?.thread?.id
  if (!threadId) throw new Error('Codex app-server did not return a thread id.')
  return threadId
}

function requireTurnId(response: unknown): string {
  const turnId = (response as TurnResponse | undefined)?.turn?.id
  if (!turnId) throw new Error('Codex app-server did not return a turn id.')
  return turnId
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function formatJson(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value ?? '')
}

function getToolName(item: ThreadItem): string {
  switch (item.type) {
    case 'commandExecution':
      return 'bash'
    case 'fileChange':
      return 'fileChange'
    case 'mcpToolCall':
      return `${getString(item.server) ?? 'mcp'}.${getString(item.tool) ?? 'tool'}`
    case 'dynamicToolCall':
      return [getString(item.namespace), getString(item.tool)].filter(Boolean).join('.') || 'tool'
    case 'webSearch':
      return 'webSearch'
    default:
      return item.type
  }
}

function getToolInput(item: ThreadItem): Record<string, unknown> {
  switch (item.type) {
    case 'commandExecution':
      return { command: item.command, cwd: item.cwd }
    case 'fileChange':
      return { changes: item.changes }
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return { arguments: item.arguments }
    case 'webSearch':
      return { query: item.query }
    default:
      return {}
  }
}

function getToolResult(item: ThreadItem, outputDeltas: Map<string, string[]>): string {
  switch (item.type) {
    case 'commandExecution':
      return getString(item.aggregatedOutput) ?? outputDeltas.get(item.id)?.join('') ?? ''
    case 'fileChange':
      return outputDeltas.get(item.id)?.join('') ?? formatJson(item.changes ?? [])
    case 'mcpToolCall':
      return formatJson(item.error ?? item.result ?? null)
    case 'dynamicToolCall':
      return formatJson(item.contentItems ?? item.success ?? null)
    default:
      return formatJson(item)
  }
}

function isToolItem(item: ThreadItem): boolean {
  return [
    'commandExecution',
    'fileChange',
    'mcpToolCall',
    'dynamicToolCall',
    'webSearch',
    'imageGeneration',
  ].includes(item.type)
}

function isFailedToolItem(item: ThreadItem): boolean {
  if (item.type === 'commandExecution')
    return item.status === 'failed' || (typeof item.exitCode === 'number' && item.exitCode !== 0)
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall')
    return item.status === 'failed'
  if (item.type === 'fileChange') return item.status === 'failed'
  return false
}

async function ensureChatGptAccount(client: CodexAppServerClient): Promise<void> {
  const response = (await client.request('account/read', { refreshToken: false })) as {
    account?: { type?: string } | null
  }
  const accountType = response.account?.type
  if (accountType === 'chatgpt') return
  if (accountType === 'apiKey') {
    throw new Error(
      'OpenAI in Orb uses Codex ChatGPT subscription auth. Codex is logged in with an API key; run `codex logout` then `codex login --device-auth`.',
    )
  }

  throw new Error(
    'OpenAI in Orb uses Codex ChatGPT subscription auth. Run `codex login --device-auth` first.',
  )
}

export function createOpenAiInitializeParams() {
  return {
    clientInfo: {
      name: 'orb',
      title: 'Orb',
      version: ORB_VERSION,
    },
    capabilities: {
      experimentalApi: true,
    },
  }
}

export function createOpenAiThreadParams(
  appConfig: AgentAdapterConfig['appConfig'],
  instructions: string,
  options: { persistExtendedHistory?: boolean } = {},
) {
  const params = {
    model: appConfig.llmModel,
    modelProvider: 'openai',
    cwd: appConfig.projectPath,
    approvalPolicy: 'never',
    sandbox: appConfig.yolo ? 'danger-full-access' : 'workspace-write',
    config: { model_reasoning_effort: appConfig.llmReasoningEffort },
    developerInstructions: instructions,
    experimentalRawEvents: false,
  }

  if (options.persistExtendedHistory ?? true) {
    return { ...params, persistExtendedHistory: true }
  }

  return params
}

export function isOpenAiFullHistoryCapabilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /persist(?:Full|Extended)History/i.test(message) && /experimentalApi/i.test(message)
}

export function createOpenAiTurnStartParams(
  threadId: string,
  prompt: string,
  effort: AgentAdapterConfig['appConfig']['llmReasoningEffort'],
) {
  return {
    threadId,
    input: [{ type: 'text', text: prompt, text_elements: [] }],
    effort,
  }
}

export function createOpenAiAdapter(config: AgentAdapterConfig): AgentAdapter {
  return {
    async *stream(prompt: string): AsyncIterable<Frame> {
      const { appConfig, session, abortController } = config
      const client = new CodexAppServerClient()
      const tools = createToolFrameTracker()
      const outputDeltas = new Map<string, string[]>()
      const agentMessages = createOpenAiAgentMessageAccumulator()
      let threadId = session?.provider === 'openai' ? session.threadId : undefined
      let turnId: string | undefined

      const onAbort = () => {
        if (threadId && turnId) {
          void client.request('turn/interrupt', { threadId, turnId }).catch(() => {})
        }
        void client.close()
      }
      abortController.signal.addEventListener('abort', onAbort, { once: true })

      async function startOrResumeThread(
        params: ReturnType<typeof createOpenAiThreadParams>,
      ): Promise<string> {
        if (threadId) {
          try {
            return requireThreadId(
              await client.request('thread/resume', {
                ...params,
                threadId,
              }),
            )
          } catch (err) {
            if (isOpenAiFullHistoryCapabilityError(err)) throw err
          }
        }

        return requireThreadId(
          await client.request('thread/start', {
            ...params,
            serviceName: 'orb',
          }),
        )
      }

      try {
        await client.request('initialize', createOpenAiInitializeParams())
        await client.notify('initialized', {})
        await ensureChatGptAccount(client)

        const instructions = await buildProviderPrompt({
          provider: 'openai',
          projectPath: appConfig.projectPath,
          ttsEnabled: appConfig.ttsEnabled,
        })
        const baseThreadParams = createOpenAiThreadParams(appConfig, instructions)

        try {
          threadId = await startOrResumeThread(baseThreadParams)
        } catch (err) {
          if (!isOpenAiFullHistoryCapabilityError(err)) throw err
          threadId = await startOrResumeThread(
            createOpenAiThreadParams(appConfig, instructions, {
              persistExtendedHistory: false,
            }),
          )
        }

        yield createFrame('agent-session', {
          session: { provider: 'openai', threadId },
        })

        turnId = requireTurnId(
          await client.request(
            'turn/start',
            createOpenAiTurnStartParams(threadId, prompt, appConfig.llmReasoningEffort),
          ),
        )

        let turnCompleted = false
        for await (const message of client.notifications()) {
          if (message.method === 'item/agentMessage/delta') {
            const params = message.params as {
              threadId?: string
              turnId?: string
              itemId?: string
              delta?: string
            }
            if (params.threadId !== threadId || params.turnId !== turnId) continue
            const text = appendOpenAiAgentMessageDelta(agentMessages, params)
            if (!text.delta) continue
            yield createFrame('agent-text-delta', text)
            continue
          }

          if (message.method === 'item/started') {
            const params = message.params as {
              threadId?: string
              turnId?: string
              item?: ThreadItem
            }
            if (params.threadId !== threadId || params.turnId !== turnId || !params.item) continue
            const item = params.item
            if (!isToolItem(item)) continue
            yield tools.start({
              id: item.id,
              name: getToolName(item),
              input: getToolInput(item),
            })
            continue
          }

          if (
            message.method === 'item/commandExecution/outputDelta' ||
            message.method === 'item/fileChange/outputDelta'
          ) {
            const params = message.params as {
              threadId?: string
              turnId?: string
              itemId?: string
              delta?: string
            }
            if (params.threadId !== threadId || params.turnId !== turnId || !params.itemId) continue
            const chunks = outputDeltas.get(params.itemId)
            if (chunks) chunks.push(params.delta ?? '')
            else outputDeltas.set(params.itemId, [params.delta ?? ''])
            continue
          }

          if (message.method === 'item/completed') {
            const params = message.params as {
              threadId?: string
              turnId?: string
              item?: ThreadItem
            }
            if (params.threadId !== threadId || params.turnId !== turnId || !params.item) continue
            const item = params.item
            if (!isToolItem(item)) continue
            yield* tools.result(item.id, getToolResult(item, outputDeltas), isFailedToolItem(item))
            continue
          }

          if (
            message.method === 'item/commandExecution/requestApproval' &&
            message.id !== undefined
          ) {
            await client.respond(message.id, { decision: 'decline' })
            continue
          }

          if (message.method === 'item/fileChange/requestApproval' && message.id !== undefined) {
            await client.respond(message.id, { decision: 'decline' })
            continue
          }

          if (message.method === 'turn/completed') {
            const params = message.params as {
              threadId?: string
              turn?: { id?: string; status?: string; error?: unknown }
            }
            if (params.threadId !== threadId || params.turn?.id !== turnId) continue
            if (params.turn.status === 'failed') {
              throw new Error(formatJson(params.turn.error ?? 'Codex turn failed.'))
            }
            turnCompleted = true
            yield createFrame('agent-text-complete', {
              text: agentMessages.text,
              session: { provider: 'openai', threadId },
            })
            break
          }

          if (message.method === 'error') {
            throw new Error(formatJson(message.params ?? 'Codex app-server error.'))
          }
        }

        // The notification stream can end without a `turn/completed` if the
        // `codex app-server` subprocess dies mid-turn (crash, killed, EOF, or an
        // unparseable line). Without this, the turn would silently finish with no
        // completion frame and no error. Surface it (with any captured stderr) so
        // the agent processor reports a real failure instead of a blank answer.
        if (!turnCompleted && !abortController.signal.aborted) {
          const stderr = client.getStderrText()
          throw new Error(
            stderr
              ? `Codex app-server exited before completing the turn: ${stderr}`
              : 'Codex app-server exited before completing the turn.',
          )
        }
      } finally {
        abortController.signal.removeEventListener('abort', onAbort)
        await client.close()
      }
    },
  }
}
