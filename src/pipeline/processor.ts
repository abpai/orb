import type { Frame } from './frames'

/**
 * A Processor transforms an async stream of frames.
 * Compose processors left-to-right: output of one feeds input of the next.
 * Use `finally` blocks for cleanup on cancellation (generator `.return()`).
 */
export type Processor = (upstream: AsyncIterable<Frame>) => AsyncIterable<Frame>

/**
 * Per-frame handler: receives one frame, returns zero or more frames.
 * Return `null` to filter a frame out; return the frame to pass it through.
 */
type FrameHandler = (frame: Frame) => AsyncIterable<Frame> | Iterable<Frame> | Frame | null

interface ProcessorOptions {
  onInit?: () => void | Promise<void>
  onDestroy?: () => void | Promise<void>
}

/**
 * Creates a Processor from a simpler per-frame handler.
 * Handles the common case where each input frame produces 0..N output frames.
 */
export function createProcessor(handler: FrameHandler, options?: ProcessorOptions): Processor {
  return async function* (upstream: AsyncIterable<Frame>): AsyncGenerator<Frame> {
    await options?.onInit?.()
    try {
      for await (const frame of upstream) {
        const result = handler(frame)
        if (result === null) continue
        if (isAsyncIterable(result)) {
          yield* result
        } else if (isIterable(result)) {
          yield* result
        } else {
          yield result
        }
      }
    } finally {
      await options?.onDestroy?.()
    }
  }
}

/** Helper: yield a single frame as an async iterable */
export async function* singleFrame(frame: Frame): AsyncGenerator<Frame> {
  yield frame
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Frame> {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in (value as object)
}

function isIterable(value: unknown): value is Iterable<Frame> {
  return value !== null && typeof value === 'object' && Symbol.iterator in (value as object)
}
