import type { Frame } from './frames'

/**
 * A Processor transforms an async stream of frames.
 * Compose processors left-to-right: output of one feeds input of the next.
 * Use `finally` blocks for cleanup on cancellation (generator `.return()`).
 */
export type Processor = (upstream: AsyncIterable<Frame>) => AsyncIterable<Frame>

/** Helper: yield a single frame as an async iterable */
export async function* singleFrame(frame: Frame): AsyncGenerator<Frame> {
  yield frame
}
