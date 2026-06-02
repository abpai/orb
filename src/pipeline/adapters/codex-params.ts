/**
 * Pure helpers for the Codex app-server protocol: request/response param
 * builders, thread-item classification, and notification filtering. Extracted
 * from the OpenAI adapter so the streaming glue in `openai.ts` stays focused on
 * I/O, and so these (heavily unit-tested) functions can be exercised in
 * isolation. Parallel to the `codex-client.ts` / `audio-player.ts` splits.
 */
import { ORB_VERSION } from '../../config'
import type { AgentAdapterConfig } from './types'

export interface ThreadItem {
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

/**
 * Shape of `params` on the Codex app-server notifications orb consumes. Every
 * turn-scoped notification carries `threadId`; item events add `turnId` plus
 * `item` or `itemId`/`delta`; `turn/completed` nests the turn under `turn`.
 * Centralized so the notification loop casts and filters once, not per-branch.
 */
export interface CodexNotificationParams {
  threadId?: string
  turnId?: string
  itemId?: string
  delta?: string
  item?: ThreadItem
  turn?: { id?: string; status?: string; error?: unknown }
}

/**
 * Is this item notification for the turn we're currently streaming? Item events
 * (`item/started`, `item/completed`, deltas) carry the turn under `turnId`.
 * `turn/completed` nests it under `turn.id` instead and is filtered inline at
 * that one call site, so this guard deliberately checks only `turnId`.
 */
export function isForCurrentTurn(
  params: CodexNotificationParams,
  threadId: string | undefined,
  turnId: string | undefined,
): boolean {
  return params.threadId === threadId && params.turnId === turnId
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

export function requireThreadId(response: unknown): string {
  const threadId = (response as ThreadResponse | undefined)?.thread?.id
  if (!threadId) throw new Error('Codex app-server did not return a thread id.')
  return threadId
}

export function requireTurnId(response: unknown): string {
  const turnId = (response as TurnResponse | undefined)?.turn?.id
  if (!turnId) throw new Error('Codex app-server did not return a turn id.')
  return turnId
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function formatJson(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value ?? '')
}

export function getToolName(item: ThreadItem): string {
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

export function getToolInput(item: ThreadItem): Record<string, unknown> {
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

export function getToolResult(item: ThreadItem, outputDeltas: Map<string, string[]>): string {
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

export function isToolItem(item: ThreadItem): boolean {
  return [
    'commandExecution',
    'fileChange',
    'mcpToolCall',
    'dynamicToolCall',
    'webSearch',
    'imageGeneration',
  ].includes(item.type)
}

export function isFailedToolItem(item: ThreadItem): boolean {
  if (item.type === 'commandExecution')
    return item.status === 'failed' || (typeof item.exitCode === 'number' && item.exitCode !== 0)
  if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall')
    return item.status === 'failed'
  if (item.type === 'fileChange') return item.status === 'failed'
  return false
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
