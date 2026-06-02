import { buildProviderPrompt } from '../../services/prompts'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import { CodexAppServerClient } from './codex-client'
import { createToolFrameTracker } from './utils'
import type { AgentAdapter, AgentAdapterConfig } from './types'
import {
  appendOpenAiAgentMessageDelta,
  createOpenAiAgentMessageAccumulator,
  createOpenAiInitializeParams,
  createOpenAiThreadParams,
  createOpenAiTurnStartParams,
  formatJson,
  getToolInput,
  getToolName,
  getToolResult,
  isForCurrentTurn,
  isFailedToolItem,
  isOpenAiFullHistoryCapabilityError,
  isToolItem,
  requireThreadId,
  requireTurnId,
  type CodexNotificationParams,
} from './codex-params'

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
        notifications: for await (const message of client.notifications()) {
          // `params` is read only by the branches that filtered on it before;
          // approval/error/unknown methods never touch it (and may legitimately
          // arrive without params), so the turn guard stays inside each branch.
          const params = message.params as CodexNotificationParams

          switch (message.method) {
            case 'item/agentMessage/delta': {
              if (!isForCurrentTurn(params, threadId, turnId)) break
              const text = appendOpenAiAgentMessageDelta(agentMessages, params)
              if (text.delta) yield createFrame('agent-text-delta', text)
              break
            }

            case 'item/started': {
              const item = params.item
              if (!isForCurrentTurn(params, threadId, turnId) || !item || !isToolItem(item)) break
              yield tools.start({
                id: item.id,
                name: getToolName(item),
                input: getToolInput(item),
              })
              break
            }

            case 'item/commandExecution/outputDelta':
            case 'item/fileChange/outputDelta': {
              if (!isForCurrentTurn(params, threadId, turnId) || !params.itemId) break
              const chunks = outputDeltas.get(params.itemId)
              if (chunks) chunks.push(params.delta ?? '')
              else outputDeltas.set(params.itemId, [params.delta ?? ''])
              break
            }

            case 'item/completed': {
              const item = params.item
              if (!isForCurrentTurn(params, threadId, turnId) || !item || !isToolItem(item)) break
              yield* tools.result(
                item.id,
                getToolResult(item, outputDeltas),
                isFailedToolItem(item),
              )
              break
            }

            case 'item/commandExecution/requestApproval':
            case 'item/fileChange/requestApproval': {
              if (message.id !== undefined) {
                await client.respond(message.id, { decision: 'decline' })
              }
              break
            }

            case 'turn/completed': {
              // turn/completed nests the id under `turn.id`, not `turnId`, so it
              // can't reuse the item-event guard above.
              if (params.threadId !== threadId || params.turn?.id !== turnId) break
              if (params.turn.status === 'failed') {
                throw new Error(formatJson(params.turn.error ?? 'Codex turn failed.'))
              }
              turnCompleted = true
              yield createFrame('agent-text-complete', {
                text: agentMessages.text,
                session: { provider: 'openai', threadId },
              })
              break notifications
            }

            case 'error': {
              throw new Error(formatJson(message.params ?? 'Codex app-server error.'))
            }
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
