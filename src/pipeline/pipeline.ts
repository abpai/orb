import type { Frame } from './frames'
import type { Processor } from './processor'

export interface PipelineConfig {
  processors: Processor[]
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

    return stream
  }
}
