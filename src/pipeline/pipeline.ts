import type { Frame } from './frames'
import type { Processor } from './processor'
import type { PipelineObserver } from './observer'

export interface PipelineConfig {
  processors: Processor[]
  observers?: PipelineObserver[]
}

/**
 * Creates a pipeline that chains processors left-to-right.
 * The pipeline itself is a Processor: AsyncIterable<Frame> → AsyncIterable<Frame>.
 */
export function createPipeline(config: PipelineConfig): Processor {
  return (source: AsyncIterable<Frame>) => {
    let stream: AsyncIterable<Frame> = source

    for (const processor of config.processors) {
      stream = processor(stream)
    }

    if (config.observers && config.observers.length > 0) {
      stream = tapObservers(stream, config.observers)
    }

    return stream
  }
}

/**
 * Wraps a stream to notify observers of each frame without modifying the stream.
 */
async function* tapObservers(
  upstream: AsyncIterable<Frame>,
  observers: PipelineObserver[],
): AsyncGenerator<Frame> {
  for await (const frame of upstream) {
    for (const observer of observers) {
      observer.onFrame(frame)
    }
    yield frame
  }
}
