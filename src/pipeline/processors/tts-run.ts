import { TTSError } from '../../types'

/** Control surface handed from the TTS processor to the task layer. */
export interface TTSCompletionHandle {
  waitForCompletion(): Promise<void>
  stop(): void
  pause(): void
  resume(): void
}

/**
 * A running TTS playback session.  `done` resolves when speech completes or
 * the session is stopped; errors are forwarded via `onError` rather than
 * rejecting the promise so callers can `await run.done` without a try/catch.
 */
export interface TtsRun {
  readonly done: Promise<void>
  pause(): void
  resume(): void
  stop(): void
}

export function createTtsRun(
  handle: TTSCompletionHandle,
  onError: (err: TTSError) => void,
): TtsRun {
  const done = handle.waitForCompletion().catch((err) => {
    if (err instanceof TTSError) onError(err)
  })

  return {
    done,
    pause: () => handle.pause(),
    resume: () => handle.resume(),
    stop: () => handle.stop(),
  }
}
