import type { AppState, AgentSession, AppConfig } from '../types'
import type { Frame, TTSPendingFrame } from './frames'
import { createFrame } from './frames'
import { createPipeline } from './pipeline'
import type { PipelineObserver } from './observer'
import { createAgentProcessor } from './processors/agent'
import { createTTSProcessor } from './processors/tts'
import type { Transport, OutboundFrame } from './transports/types'
import { isAbortError } from './adapters/utils'

export type TaskState = AppState

export interface RunResult {
  entryId: string
  text: string
  session?: AgentSession
  error?: Error
  cancelled: boolean
}

export interface PipelineTaskConfig {
  appConfig: AppConfig
  session?: AgentSession
  transport: Transport
  observers?: PipelineObserver[]
}

type StateListener = (state: TaskState) => void

export interface PipelineTask {
  readonly state: TaskState
  onStateChange(listener: StateListener): () => void
  run(query: string, entryId: string): Promise<RunResult>
  cancel(): void
  updateConfig(config: AppConfig): void
  updateSession(session: AgentSession | undefined): void
}

/** Outbound frame kinds that get routed to the transport */
const OUTBOUND_KINDS = new Set<string>([
  'agent-text-delta',
  'agent-text-complete',
  'tool-call-start',
  'tool-call-result',
  'agent-error',
  'tts-speaking-start',
  'tts-speaking-end',
  'tts-error',
])

export function createPipelineTask(taskConfig: PipelineTaskConfig): PipelineTask {
  let state: TaskState = 'idle'
  let config = taskConfig.appConfig
  let session: AgentSession | undefined = taskConfig.session
  const transport = taskConfig.transport
  const observers = taskConfig.observers ?? []
  const stateListeners = new Set<StateListener>()

  let runCounter = 0
  let currentAbort: AbortController | null = null
  let currentTtsPending: TTSPendingFrame | null = null

  function setState(next: TaskState): void {
    if (next === state) return
    state = next
    for (const listener of stateListeners) {
      listener(next)
    }
  }

  function isOutboundFrame(frame: Frame): frame is OutboundFrame {
    return OUTBOUND_KINDS.has(frame.kind)
  }

  const task: PipelineTask = {
    get state() {
      return state
    },

    onStateChange(listener: StateListener): () => void {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },

    async run(query: string, entryId: string): Promise<RunResult> {
      // Cancel any in-progress run
      if (currentAbort) {
        currentAbort.abort()
        currentAbort = null
      }
      if (currentTtsPending) {
        currentTtsPending.stop()
        currentTtsPending = null
      }

      const runId = ++runCounter
      const abortController = new AbortController()
      currentAbort = abortController

      setState('processing')

      let finalText = ''
      let finalSession: AgentSession | undefined
      let ttsPending: TTSPendingFrame | null = null
      let error: Error | undefined

      // Notify observers
      for (const observer of observers) {
        observer.onRunStart?.(runId)
      }

      // Build pipeline: agent → tts
      const pipeline = createPipeline({
        processors: [
          createAgentProcessor({
            appConfig: config,
            session,
            abortController,
          }),
          createTTSProcessor(config),
        ],
        observers,
      })

      // Create frame source
      const source = singleFrameSource(createFrame('user-text', { text: query, entryId }))

      try {
        for await (const frame of pipeline(source)) {
          // Stale run check
          if (runId !== runCounter) break

          switch (frame.kind) {
            case 'agent-text-complete':
              finalText = frame.text
              if (frame.session) finalSession = frame.session
              break

            case 'agent-session':
              finalSession = frame.session
              break

            case 'agent-error':
              error = frame.error
              break

            case 'tts-speaking-start':
              setState(state === 'processing' ? 'processing_speaking' : 'speaking')
              break

            case 'tts-speaking-end':
              if (state === 'processing_speaking') setState('processing')
              else if (state === 'speaking') setState('idle')
              break

            case 'tts-pending':
              ttsPending = frame
              currentTtsPending = frame
              break
          }

          // Route displayable frames to transport
          if (isOutboundFrame(frame)) {
            transport.sendOutbound(frame)
          }
        }
      } catch (err) {
        if (!isAbortError(err)) {
          error = err instanceof Error ? err : new Error(String(err))
        }
      }

      // Handle TTS pending work (speaking state after agent completes)
      if (ttsPending && runId === runCounter && !error) {
        setState('speaking')
        try {
          await ttsPending.waitForCompletion()
        } catch (err) {
          // TTS completion errors are non-fatal; the text was already delivered
          if (err instanceof Error && 'type' in err) {
            transport.sendOutbound(
              createFrame('tts-error', {
                errorType: (err as { type: string }).type as import('../types').TTSErrorType,
                message: err.message,
              }) as OutboundFrame,
            )
          }
        } finally {
          if (currentTtsPending === ttsPending) {
            currentTtsPending = null
          }
        }
      }

      // Notify observers of run end
      for (const observer of observers) {
        observer.onRunEnd?.({
          runId,
          startTime: 0, // observers track their own startTime via onRunStart
          endTime: Date.now(),
          totalTextChars: 0,
          toolCallCount: 0,
          toolErrorCount: 0,
          ttsErrorCount: 0,
          frameCounts: {},
        })
      }

      // Final state transition
      const cancelled = runId !== runCounter
      if (!cancelled) {
        setState('idle')
        currentAbort = null

        // Update session for future runs
        if (finalSession) {
          session = finalSession
        }
      }

      return { entryId, text: finalText, session: finalSession, error, cancelled }
    },

    cancel(): void {
      runCounter++ // invalidate current run
      currentAbort?.abort()
      currentAbort = null
      currentTtsPending?.stop()
      currentTtsPending = null
      setState('idle')
    },

    updateConfig(newConfig: AppConfig): void {
      config = newConfig
    },

    updateSession(newSession: AgentSession | undefined): void {
      session = newSession
    },
  }

  return task
}

/** Creates an async iterable that yields a single frame */
async function* singleFrameSource(frame: Frame): AsyncIterable<Frame> {
  yield frame
}
