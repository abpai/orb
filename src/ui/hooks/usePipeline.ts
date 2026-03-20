import { useCallback, useEffect, useMemo, useState } from 'react'

import { createPipelineTask } from '../../pipeline/task'
import type { RunResult, TaskState } from '../../pipeline/task'
import { createTerminalTextTransport } from '../../pipeline/transports/terminal-text'
import type { OutboundFrame, Transport } from '../../pipeline/transports/types'
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
  onRunComplete(result: RunResult): void
  onStateChange(state: TaskState): void
  startEntry(query: string): PendingRun | null
}

export function usePipeline({
  config,
  activeModel,
  initialModel,
  initialSession,
  onFrame,
  onRunComplete,
  onStateChange,
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

  const submit = useCallback(
    async (query: string) => {
      const pendingRun = startEntry(query)
      if (!pendingRun) return

      const result = await task.run(pendingRun.query, pendingRun.entryId)
      onRunComplete(result)
    },
    [onRunComplete, startEntry, task],
  )

  return { cancel, state, submit }
}
