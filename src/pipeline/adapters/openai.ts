import { buildProviderPrompt } from '../../services/prompts'
import { ORB_VERSION } from '../../config'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { AgentAdapter, AgentAdapterConfig } from './types'

type JsonRpcId = number

interface JsonRpcMessage {
  id?: JsonRpcId
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

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

class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value, done: false })
      return
    }
    this.values.push(value)
  }

  end(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as T, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
    }
  }
}

class CodexAppServerClient {
  private readonly proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
  private readonly encoder = new TextEncoder()
  private readonly pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private readonly queue = new AsyncMessageQueue<JsonRpcMessage>()
  private nextId = 1
  private stderrText = ''

  constructor() {
    this.proc = Bun.spawn({
      cmd: ['codex', 'app-server'],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    void this.readStdout()
    void this.readStderr()
  }

  notifications(): AsyncIterable<JsonRpcMessage> {
    return this.queue
  }

  async initialize(): Promise<void> {
    await this.request('initialize', createOpenAiInitializeParams())
    await this.notify('initialized', {})
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    await this.write({ method, id, params })
    return response
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.write({ method, params })
  }

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    await this.write({ id, result })
  }

  async close(): Promise<void> {
    this.queue.end()
    for (const { reject } of this.pending.values()) {
      reject(new Error('Codex app-server closed before responding.'))
    }
    this.pending.clear()

    try {
      await this.proc.stdin.end()
    } catch {
      // Process may already be gone.
    }
    this.proc.kill()
    await this.proc.exited.catch(() => {})
  }

  private async write(message: JsonRpcMessage): Promise<void> {
    this.proc.stdin.write(this.encoder.encode(`${JSON.stringify(message)}\n`))
    await this.proc.stdin.flush()
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined && !message.method) {
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) {
        waiter.reject(new Error(message.error.message ?? `Codex app-server error ${message.id}`))
      } else {
        waiter.resolve(message.result)
      }
      return
    }

    this.queue.push(message)
  }

  private async readStdout(): Promise<void> {
    const decoder = new TextDecoder()
    const reader = this.proc.stdout.getReader()
    let buffer = ''

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          if (line) this.handleMessage(JSON.parse(line) as JsonRpcMessage)
          newlineIndex = buffer.indexOf('\n')
        }
      }
      const finalLine = buffer.trim()
      if (finalLine) this.handleMessage(JSON.parse(finalLine) as JsonRpcMessage)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      for (const { reject } of this.pending.values()) reject(err)
      this.pending.clear()
    } finally {
      this.queue.end()
    }
  }

  private async readStderr(): Promise<void> {
    try {
      this.stderrText = await new Response(this.proc.stderr).text()
    } catch {
      this.stderrText = ''
    }
  }

  getStderrText(): string {
    return this.stderrText.trim()
  }
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

function getToolResult(item: ThreadItem, outputDeltas: Map<string, string>): string {
  switch (item.type) {
    case 'commandExecution':
      return getString(item.aggregatedOutput) ?? outputDeltas.get(item.id) ?? ''
    case 'fileChange':
      return outputDeltas.get(item.id) ?? formatJson(item.changes ?? [])
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
  if (item.type === 'commandExecution') return item.status === 'failed' || item.exitCode !== 0
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
      const toolIdToIndex = new Map<string, number>()
      const outputDeltas = new Map<string, string>()
      let toolIndex = 0
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

      function getOrCreateToolIndex(itemId: string): number {
        const existing = toolIdToIndex.get(itemId)
        if (existing !== undefined) return existing
        const nextIndex = toolIndex++
        toolIdToIndex.set(itemId, nextIndex)
        return nextIndex
      }

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
        await client.initialize()
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
            const index = getOrCreateToolIndex(item.id)
            yield createFrame('tool-call-start', {
              toolCall: {
                id: item.id,
                index,
                name: getToolName(item),
                input: getToolInput(item),
                status: 'running',
              },
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
            outputDeltas.set(
              params.itemId,
              `${outputDeltas.get(params.itemId) ?? ''}${params.delta ?? ''}`,
            )
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
            const index = getOrCreateToolIndex(item.id)
            yield createFrame('tool-call-result', {
              toolIndex: index,
              result: getToolResult(item, outputDeltas),
              status: isFailedToolItem(item) ? 'error' : 'complete',
            })
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
      } finally {
        abortController.signal.removeEventListener('abort', onAbort)
        await client.close()
      }
    },
  }
}
