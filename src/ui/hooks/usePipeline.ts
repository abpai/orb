import { useCallback, useEffect, useMemo, useState } from 'react'

import { createPipelineTask } from '../../pipeline/task'
import type { RunResult, TaskState } from '../../pipeline/task'
import { createTerminalTextTransport } from '../../pipeline/transports/terminal-text'
import type { OutboundFrame, Transport } from '../../pipeline/transports/types'
import { expandSlashCommandInput } from '../../services/commands'
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
  onFrame(frame: OutboundFrame): void
  onSubmitBuiltin(query: string, answer: string): void
  onRunComplete(result: RunResult): void
  onStateChange(state: TaskState): void
  onSubmitError(query: string, message: string): void
  startEntry(query: string): PendingRun | null
}

export function usePipeline({
  config,
  activeModel,
  initialModel,
  initialSession,
  onFrame,
  onSubmitBuiltin,
  onRunComplete,
  onStateChange,
  onSubmitError,
  startEntry,
}: UsePipelineConfig) {
  const [state, setState] = useState<TaskState>('idle')
  const activeConfig = useMemo(() => ({ ...config, llmModel: activeModel }), [config, activeModel])

  const { task, transport } = useMemo(() => {
    const nextTransport = createTerminalTextTransport()
    const nextTask = createPipelineTask({
      appConfig: { ...config, llmModel: initialModel },
      session: initialSession,
      transport: nextTransport,
    })

    return {
      task: nextTask,
      transport: nextTransport as Transport,
    }
  }, []) as { task: ReturnType<typeof createPipelineTask>; transport: Transport }

  useEffect(() => {
    task.updateConfig(activeConfig)
  }, [task, activeConfig])

  useEffect(
    () =>
      task.onStateChange((nextState) => {
        setState(nextState)
        onStateChange(nextState)
      }),
    [onStateChange, task],
  )

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
    [config.projectPath, onRunComplete, onSubmitBuiltin, onSubmitError, startEntry, task],
  )

  return { cancel, pause, resume, repeat, state, stopPlayback, submit }
}
