import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { Processor } from '../processor'
import type { AppConfig } from '../../types'
import { TTSError } from '../../types'
import { createStreamingSpeechController } from '../../services/streaming-tts'
import type { TTSCompletionHandle } from './tts-run'

export type { TTSCompletionHandle } from './tts-run'

interface TTSRunControl {
  setCompletion(handle: TTSCompletionHandle | null): void
}

/**
 * TTSProcessor: intercepts agent text frames to drive TTS through a single
 * StreamingSpeechController, then hands its control surface
 * (wait/stop/pause/resume) to the PipelineTask.
 *
 * Streaming mode feeds text deltas as they arrive so audio starts mid-response;
 * batch mode withholds the deltas and feeds the whole text once the response
 * completes. Both then finalize the same controller — there is no longer a
 * separate file-by-file batch path.
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

    const feedDeltas = appConfig.ttsStreamingEnabled
    const pendingTTSFrames: Frame[] = []
    const controller = createStreamingSpeechController(appConfig, {
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
    let controllerHandedOff = false

    function* drainPending(): Iterable<Frame> {
      while (pendingTTSFrames.length > 0) {
        yield pendingTTSFrames.shift()!
      }
    }

    try {
      for await (const frame of upstream) {
        // Streaming mode: feed deltas as they arrive. Batch mode waits for the
        // complete text below.
        if (frame.kind === 'agent-text-delta' && feedDeltas) {
          controller.feedText(frame.delta)
        }

        // On agent completion, finalize TTS and hand off the playback session.
        if (frame.kind === 'agent-text-complete') {
          // Batch mode withheld the deltas; feed the whole text now so both
          // modes converge on the same finalize + handoff.
          if (!feedDeltas) controller.feedText(frame.text)
          controller.finalize()
          yield frame
          yield* drainPending()

          if (controller.isActive()) {
            controllerHandedOff = true
            runControl?.setCompletion({
              waitForCompletion: () => controller.waitForCompletion(),
              stop: () => controller.stop(),
              pause: () => controller.pause(),
              resume: () => controller.resume(),
            })
          }
          continue
        }

        // Pass through all frames + drain any TTS side-effect frames
        yield frame
        yield* drainPending()
      }
    } finally {
      if (!controllerHandedOff) {
        controller.stop()
      }
    }
  }
}
