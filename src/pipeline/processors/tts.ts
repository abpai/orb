import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { Processor } from '../processor'
import type { AppConfig } from '../../types'
import { TTSError } from '../../types'
import {
  createStreamingSpeechController,
  type StreamingSpeechController,
} from '../../services/streaming-tts'
import { pauseSpeaking, resumeSpeaking, speak, stopSpeaking } from '../../services/tts'

export interface TTSCompletionHandle {
  waitForCompletion(): Promise<void>
  stop(): void
  pause(): void
  resume(): void
}

export interface TTSRunControl {
  setCompletion(handle: TTSCompletionHandle | null): void
}

/**
 * TTSProcessor: intercepts agent text frames to drive TTS.
 *
 * Streaming mode: wraps StreamingSpeechController, feeds text deltas,
 * emits speaking start/end/error frames, and hands a completion handle
 * to the PipelineTask to await.
 *
 * Batch mode: hands a completion handle to the PipelineTask on completion
 * that speaks the full text.
 *
 * All frames pass through to downstream (transport sees them for UI updates).
 */
export function createTTSProcessor(appConfig: AppConfig, runControl?: TTSRunControl): Processor {
  return async function* ttsProcessor(upstream: AsyncIterable<Frame>): AsyncGenerator<Frame> {
    if (!appConfig.ttsEnabled) {
      runControl?.setCompletion(null)
      yield* upstream
      return
    }

    const useStreaming = appConfig.ttsStreamingEnabled
    let controller: StreamingSpeechController | null = null
    let controllerHandedOff = false
    const pendingTTSFrames: Frame[] = []

    if (useStreaming) {
      controller = createStreamingSpeechController(appConfig, {
        onSpeakingStart: () => {
          pendingTTSFrames.push(createFrame('tts-speaking-start'))
        },
        onSpeakingEnd: () => {
          pendingTTSFrames.push(createFrame('tts-speaking-end'))
        },
        onError: (err: TTSError) => {
          pendingTTSFrames.push(
            createFrame('tts-error', {
              errorType: err.type,
              message: err.message,
            }),
          )
        },
      })
    }

    function* drainPending(): Iterable<Frame> {
      while (pendingTTSFrames.length > 0) {
        yield pendingTTSFrames.shift()!
      }
    }

    let completedText = ''

    try {
      for await (const frame of upstream) {
        // Feed text deltas to streaming TTS controller
        if (frame.kind === 'agent-text-delta' && controller) {
          controller.feedText(frame.delta)
        }

        // On agent completion, finalize TTS
        if (frame.kind === 'agent-text-complete') {
          completedText = frame.text

          if (controller) {
            // Streaming mode: finalize and yield pending frame
            controller.finalize()
            yield frame
            yield* drainPending()

            if (controller.isActive()) {
              const ctrl = controller
              controllerHandedOff = true
              runControl?.setCompletion({
                waitForCompletion: () => ctrl.waitForCompletion(),
                stop: () => ctrl.stop(),
                pause: () => ctrl.pause(),
                resume: () => ctrl.resume(),
              })
            }
            continue
          }

          // Batch mode: hand the synthesized playback work to the task layer.
          yield frame
          runControl?.setCompletion({
            waitForCompletion: () => speak(completedText, appConfig),
            stop: () => stopSpeaking(),
            pause: () => pauseSpeaking(),
            resume: () => resumeSpeaking(),
          })
          continue
        }

        // Pass through all frames + drain any TTS side-effect frames
        yield frame
        yield* drainPending()
      }
    } finally {
      if (!controllerHandedOff) {
        controller?.stop()
      }
    }
  }
}
