import { promises as fsp, realpathSync } from 'node:fs'
import * as path from 'node:path'

import {
  query,
  type CanUseTool,
  type PermissionResult,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { buildProviderPrompt } from '../../services/prompts'
import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { AgentAdapter, AgentAdapterConfig } from './types'
import {
  getContentBlocks,
  isTextBlock,
  isToolUseBlock,
  isToolResultBlock,
  extractToolResultText,
} from './utils'

export function createAnthropicAdapter(config: AgentAdapterConfig): AgentAdapter {
  return {
    async *stream(prompt: string): AsyncIterable<Frame> {
      const { appConfig, session, abortController } = config
      let activeSessionId = session?.provider === 'anthropic' ? session.sessionId : undefined
      let accumulatedText = ''
      let toolIndex = 0
      const toolIdToIndex = new Map<string, number>()
      const systemPrompt = await buildProviderPrompt({
        provider: 'anthropic',
        projectPath: appConfig.projectPath,
        ttsEnabled: appConfig.ttsEnabled,
      })

      const response = query({
        prompt,
        options: {
          cwd: appConfig.projectPath,
          model: appConfig.llmModel,
          maxTurns: 10,
          resume: activeSessionId,
          permissionMode: 'default',
          canUseTool: createCanUseTool(appConfig.projectPath),
          abortController,
          systemPrompt,
        },
      })

      for await (const message of response) {
        const typed = message as SDKMessage

        if (typed.type === 'system' && typed.subtype === 'init') {
          const newSessionId = (typed as { session_id?: string }).session_id
          if (newSessionId) {
            activeSessionId = newSessionId
            yield createFrame('agent-session', {
              session: { provider: 'anthropic', sessionId: newSessionId },
            })
          }
          continue
        }

        if (typed.type === 'assistant') {
          const blocks = getContentBlocks(typed.message)
          for (const block of blocks) {
            if (isTextBlock(block)) {
              accumulatedText += block.text
              yield createFrame('agent-text-delta', {
                delta: block.text,
                accumulatedText,
              })
              continue
            }
            if (isToolUseBlock(block)) {
              const toolId = block.id ?? block.tool_use_id ?? `tool-${toolIndex}`
              const index = toolIdToIndex.get(toolId) ?? toolIndex++
              toolIdToIndex.set(toolId, index)
              yield createFrame('tool-call-start', {
                toolCall: {
                  id: toolId,
                  index,
                  name: block.name,
                  input: block.input ?? {},
                  status: 'running',
                },
              })
            }
          }
          continue
        }

        if (typed.type === 'user') {
          const blocks = getContentBlocks(typed.message)
          for (const block of blocks) {
            if (!isToolResultBlock(block)) continue
            const toolUseId = block.tool_use_id ?? block.id
            const index = toolUseId ? toolIdToIndex.get(toolUseId) : undefined
            if (index === undefined) continue
            const resultText = extractToolResultText(block.content)
            yield createFrame('tool-call-result', {
              toolIndex: index,
              result: resultText,
              status: block.is_error ? 'error' : 'complete',
            })
          }
        }

        if (typed.type === 'result' && typed.subtype === 'success') {
          yield createFrame('agent-text-complete', {
            text: typed.result || accumulatedText,
            session: activeSessionId
              ? { provider: 'anthropic', sessionId: activeSessionId }
              : undefined,
          })
        }
      }
    },
  }
}

// Tools whose `file_path` (or `notebook_path`) input we clamp to projectPath.
// Reads, search, and bash stay unrestricted — bash can already do whatever the
// host shell allows, so trying to filter it would only create a false sense of
// safety. For writes we resolve the deepest existing ancestor through realpath
// so symlink escapes are denied for both existing files and new descendants.
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const ALLOW: PermissionResult = { behavior: 'allow' }

export function createCanUseTool(projectRoot: string): CanUseTool {
  const root = realpathSync(path.resolve(projectRoot))
  return async (toolName, input) => {
    if (!WRITE_TOOLS.has(toolName)) return ALLOW

    const target = (input.file_path ?? input.notebook_path) as string | undefined
    if (typeof target !== 'string' || target.length === 0) return ALLOW

    try {
      const resolved = await resolvePathForWrite(root, target)
      if (resolved === root || resolved.startsWith(root + path.sep)) return ALLOW

      return {
        behavior: 'deny',
        message: `${toolName} blocked: ${resolved} is outside project root ${root}. Writes are limited to the project directory; reads from anywhere are fine.`,
      }
    } catch (err) {
      return {
        behavior: 'deny',
        message: `${toolName} blocked: failed to validate ${target} against project root ${root}: ${(err as Error).message}`,
      }
    }
  }
}

async function resolvePathForWrite(root: string, target: string): Promise<string> {
  const candidate = path.resolve(root, target)
  try {
    return await fsp.realpath(candidate)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err

    let cur = path.dirname(candidate)
    const tail = [path.basename(candidate)]
    while (true) {
      try {
        const realCur = await fsp.realpath(cur)
        return path.join(realCur, ...tail)
      } catch (innerErr) {
        if ((innerErr as NodeJS.ErrnoException).code !== 'ENOENT') throw innerErr
        const parent = path.dirname(cur)
        if (parent === cur) throw err
        tail.unshift(path.basename(cur))
        cur = parent
      }
    }
  }
}
