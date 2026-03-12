import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { Processor } from '../processor'
import type { AppConfig } from '../../types'
import { TTSError } from '../../types'
import {
  createStreamingSpeechController,
  type StreamingSpeechController,
} from '../../services/streaming-tts'
import { speak, stopSpeaking } from '../../services/tts'

/**
 * TTSProcessor: intercepts agent text frames to drive TTS.
 *
 * Streaming mode: wraps StreamingSpeechController, feeds text deltas,
 * emits speaking start/end/error frames, and yields a tts-pending frame
 * for the PipelineTask to await.
 *
 * Batch mode: yields a tts-pending frame on completion that speaks the full text.
 *
 * All frames pass through to downstream (transport sees them for UI updates).
 */
export function createTTSProcessor(appConfig: AppConfig): Processor {
  return async function* ttsProcessor(upstream: AsyncIterable<Frame>): AsyncGenerator<Frame> {
    if (!appConfig.ttsEnabled) {
      yield* upstream
      return
    }

    const useStreaming = appConfig.ttsStreamingEnabled
    let controller: StreamingSpeechController | null = null
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
              yield createFrame('tts-pending', {
                waitForCompletion: () => ctrl.waitForCompletion(),
                stop: () => ctrl.stop(),
              })
            }
            continue
          }

          // Batch mode: yield frame, then pending frame for batch speak
          yield frame
          yield createFrame('tts-pending', {
            waitForCompletion: () => speak(completedText, appConfig),
            stop: () => stopSpeaking(),
          })
          continue
        }

        // Pass through all frames + drain any TTS side-effect frames
        yield frame
        yield* drainPending()
      }
    } finally {
      controller?.stop()
    }
  }
}
