import { TTSError, type AppState, type AgentSession, type AppConfig } from '../types'
import type { Frame } from './frames'
import { createFrame } from './frames'
import { singleFrame } from './processor'
import { createPipeline } from './pipeline'
import type { PipelineObserver } from './observer'
import { createAgentProcessor } from './processors/agent'
import { createTTSProcessor, type TTSCompletionHandle } from './processors/tts'
import { pauseSpeaking, resumeSpeaking, speak, stopSpeaking } from '../services/tts'
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
  pause(): void
  resume(): void
  repeatTts(text: string): Promise<void>
  stopPlayback(): void
  updateConfig(config: AppConfig): void
}

/** Outbound frame kinds that get routed to the transport */
const OUTBOUND_KINDS = new Set<Frame['kind']>([
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
  let currentTtsCompletion: TTSCompletionHandle | null = null

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

  function stopActivePlayback(): void {
    const hasSpeakingState = state === 'speaking' || state === 'processing_speaking'
    if (!currentTtsCompletion && !hasSpeakingState) return

    currentTtsCompletion?.stop()
    currentTtsCompletion = null
    stopSpeaking()

    if (state === 'speaking') {
      setState('idle')
    } else if (state === 'processing_speaking') {
      setState('processing')
    }
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
      stopActivePlayback()

      const runId = ++runCounter
      const abortController = new AbortController()
      currentAbort = abortController

      setState('processing')

      let finalText = ''
      let finalSession: AgentSession | undefined
      let ttsCompletion: TTSCompletionHandle | null = null
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
          createTTSProcessor(config, {
            setCompletion(handle) {
              ttsCompletion = handle
              currentTtsCompletion = handle
            },
          }),
        ],
        observers,
      })

      // Create frame source
      const source = singleFrame(createFrame('user-text', { text: query, entryId }))

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
      if (ttsCompletion && runId === runCounter && !error) {
        const completion = ttsCompletion as TTSCompletionHandle
        setState('speaking')
        try {
          await completion.waitForCompletion()
        } catch (err) {
          if (runId === runCounter && err instanceof TTSError) {
            transport.sendOutbound(
              createFrame('tts-error', {
                errorType: err.type,
                message: err.message,
              }) as OutboundFrame,
            )
          }
        } finally {
          if (currentTtsCompletion === completion) {
            currentTtsCompletion = null
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
      stopActivePlayback()
      setState('idle')
    },

    pause(): void {
      currentTtsCompletion?.pause()
    },

    resume(): void {
      currentTtsCompletion?.resume()
    },

    async repeatTts(text: string): Promise<void> {
      if (!config.ttsEnabled) return
      if (state !== 'idle') return
      const trimmed = text.trim()
      if (!trimmed) return

      const runId = ++runCounter
      const completion: TTSCompletionHandle = {
        waitForCompletion: () => speak(trimmed, config),
        stop: () => stopSpeaking(),
        pause: () => pauseSpeaking(),
        resume: () => resumeSpeaking(),
      }
      currentTtsCompletion = completion
      setState('speaking')

      try {
        await completion.waitForCompletion()
      } catch (err) {
        if (runId === runCounter && err instanceof TTSError) {
          transport.sendOutbound(
            createFrame('tts-error', {
              errorType: err.type,
              message: err.message,
            }) as OutboundFrame,
          )
        }
      } finally {
        if (currentTtsCompletion === completion) {
          currentTtsCompletion = null
        }
        if (runId === runCounter) {
          setState('idle')
        }
      }
    },

    stopPlayback(): void {
      stopActivePlayback()
    },

    updateConfig(newConfig: AppConfig): void {
      config = newConfig
    },
  }

  return task
}
