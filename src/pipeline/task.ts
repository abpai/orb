import type { AppState, AgentSession, AppConfig } from '../types'
import type { Frame } from './frames'
import { createFrame } from './frames'
import { singleFrame } from './processor'
import { createPipeline } from './pipeline'
import { createAgentProcessor } from './processors/agent'
import { createEditorMarkerProcessor } from './processors/editor-marker'
import { createTTSProcessor } from './processors/tts'
import { createTtsRun, type TtsRun, type TTSCompletionHandle } from './processors/tts-run'
import { openInEditor } from '../services/editor'
import { warn } from '../services/log'
import { stopSpeaking } from '../services/tts'
import { speakText } from '../services/streaming-tts'
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

interface PipelineTaskConfig {
  appConfig: AppConfig
  session?: AgentSession
  transport: Transport
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
  const stateListeners = new Set<StateListener>()

  let runCounter = 0
  let currentAbort: AbortController | null = null
  let currentTtsRun: TtsRun | null = null

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
    if (!currentTtsRun && !hasSpeakingState) return

    currentTtsRun?.stop()
    currentTtsRun = null
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

      // Build pipeline: agent → tts
      const pipeline = createPipeline({
        processors: [
          createAgentProcessor({
            appConfig: config,
            session,
            abortController,
          }),
          createEditorMarkerProcessor({
            open: (refs) => {
              void openInEditor(refs, { projectPath: config.projectPath }).catch((err) => {
                warn('openInEditor failed', err)
              })
            },
          }),
          createTTSProcessor(config, {
            setCompletion(handle) {
              ttsCompletion = handle
            },
          }),
        ],
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
        setState('speaking')
        const run = createTtsRun(ttsCompletion, (err) => {
          if (runId === runCounter) {
            transport.sendOutbound(
              createFrame('tts-error', {
                errorType: err.type,
                message: err.message,
              }) as OutboundFrame,
            )
          }
        })
        currentTtsRun = run
        await run.done
        if (currentTtsRun === run) currentTtsRun = null
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
      currentTtsRun?.pause()
    },

    resume(): void {
      currentTtsRun?.resume()
    },

    async repeatTts(text: string): Promise<void> {
      if (!config.ttsEnabled) return
      if (state !== 'idle') return
      const trimmed = text.trim()
      if (!trimmed) return

      const runId = ++runCounter
      const controller = speakText(trimmed, config)
      const handle: TTSCompletionHandle = {
        waitForCompletion: () => controller.waitForCompletion(),
        stop: () => controller.stop(),
        pause: () => controller.pause(),
        resume: () => controller.resume(),
      }
      setState('speaking')
      const run = createTtsRun(handle, (err) => {
        if (runId === runCounter) {
          transport.sendOutbound(
            createFrame('tts-error', {
              errorType: err.type,
              message: err.message,
            }) as OutboundFrame,
          )
        }
      })
      currentTtsRun = run
      await run.done
      if (currentTtsRun === run) currentTtsRun = null
      if (runId === runCounter) setState('idle')
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
