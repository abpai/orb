import { useCallback, useEffect, useMemo, useRef } from 'react'

import { createPipelineTask } from '../../pipeline/task'
import type { RunResult, TaskState } from '../../pipeline/task'
import { createTerminalTextTransport } from '../../pipeline/transports/terminal-text'
import type { OutboundFrame, Transport } from '../../pipeline/transports/types'
import { expandSlashCommandInput, type SlashActionName } from '../../services/commands'
import type { AgentSession, AppConfig } from '../../types'

interface PendingRun {
  entryId: string
  query: string
}

interface UsePipelineConfig {
  config: AppConfig
  activeModel: string
  initialModel: string
  initialSession?: AgentSession
  /** Task factory; overridable in tests to avoid spinning up the real pipeline. */
  createTask?: typeof createPipelineTask
  onFrame(frame: OutboundFrame): void
  onSubmitBuiltin(query: string, answer: string): void
  onAction(action: SlashActionName): void
  onRunComplete(result: RunResult): void
  onStateChange(state: TaskState): void
  onSubmitError(query: string, message: string): void
  onOpenFiles(args: string): void | Promise<void>
  startEntry(query: string): PendingRun | null
}

/** Matches `/open` with optional trailing file args, e.g. `/open src/foo.ts:42`. */
const OPEN_COMMAND_RE = /^\/open(?:\s+([\s\S]*))?$/

export function usePipeline({
  config,
  activeModel,
  initialModel,
  initialSession,
  createTask = createPipelineTask,
  onFrame,
  onSubmitBuiltin,
  onAction,
  onRunComplete,
  onStateChange,
  onSubmitError,
  onOpenFiles,
  startEntry,
}: UsePipelineConfig) {
  const activeConfig = useMemo(() => ({ ...config, llmModel: activeModel }), [config, activeModel])

  // One-time inputs (captured at mount): initialModel, initialSession, createTask.
  // Mutable inputs (synced via updateConfig below): config / activeConfig.
  const instanceRef = useRef<{ task: ReturnType<typeof createPipelineTask>; transport: Transport } | null>(null)
  if (!instanceRef.current) {
    const nextTransport = createTerminalTextTransport()
    instanceRef.current = {
      task: createTask({
        appConfig: { ...config, llmModel: initialModel },
        session: initialSession,
        transport: nextTransport,
      }),
      transport: nextTransport as Transport,
    }
  }
  const { task, transport } = instanceRef.current

  useEffect(() => {
    task.updateConfig(activeConfig)
  }, [task, activeConfig])

  useEffect(() => task.onStateChange(onStateChange), [onStateChange, task])

  useEffect(() => transport.onOutbound(onFrame), [onFrame, transport])

  const cancel = useCallback(() => {
    task.cancel()
  }, [task])

  const pause = useCallback(() => {
    task.pause()
  }, [task])

  const resume = useCallback(() => {
    task.resume()
  }, [task])

  const repeat = useCallback(
    (text: string) => {
      return task.repeatTts(text)
    },
    [task],
  )

  const stopPlayback = useCallback(() => {
    task.stopPlayback()
  }, [task])

  const submit = useCallback(
    async (query: string) => {
      if (!query.trim()) return

      task.stopPlayback()

      // `/open [files]` is a local editor action, not a prompt — handle it
      // before slash-command expansion so it never reaches the agent.
      const openMatch = query.trim().match(OPEN_COMMAND_RE)
      if (openMatch) {
        await onOpenFiles((openMatch[1] ?? '').trim())
        return
      }

      let prompt = query
      try {
        const expanded = await expandSlashCommandInput({
          input: query,
          projectPath: config.projectPath,
        })
        if (expanded.kind === 'builtin') {
          onSubmitBuiltin(query, expanded.answer)
          return
        }
        if (expanded.kind === 'action') {
          onAction(expanded.action)
          return
        }
        prompt = expanded.prompt
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        onSubmitError(query, message)
        return
      }

      const pendingRun = startEntry(prompt)
      if (!pendingRun) return

      const result = await task.run(pendingRun.query, pendingRun.entryId)
      onRunComplete(result)
    },
    [
      config.projectPath,
      onAction,
      onOpenFiles,
      onRunComplete,
      onSubmitBuiltin,
      onSubmitError,
      startEntry,
      task,
    ],
  )

  return { cancel, pause, resume, repeat, stopPlayback, submit }
}
