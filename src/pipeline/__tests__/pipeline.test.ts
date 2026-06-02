import { describe, expect, it, beforeEach } from 'bun:test'
import { createFrame, resetFrameIds, type Frame } from '../frames'
import type { Processor } from '../processor'
import { createPipeline } from '../pipeline'

async function collectFrames(source: AsyncIterable<Frame>): Promise<Frame[]> {
  const result: Frame[] = []
  for await (const frame of source) {
    result.push(frame)
  }
  return result
}

async function* fromFrames(frames: Frame[]): AsyncIterable<Frame> {
  for (const frame of frames) {
    yield frame
  }
}

/** Test helper: build a Processor from a per-frame handler (frame, list, or null to drop). */
function mapProcessor(handler: (frame: Frame) => Frame | Frame[] | null): Processor {
  return async function* (upstream: AsyncIterable<Frame>): AsyncGenerator<Frame> {
    for await (const frame of upstream) {
      const result = handler(frame)
      if (result === null) continue
      if (Array.isArray(result)) yield* result
      else yield result
    }
  }
}

describe('createPipeline', () => {
  beforeEach(() => {
    resetFrameIds()
  })

  it('chains processors left-to-right', async () => {
    const log: string[] = []

    const p1: Processor = mapProcessor((frame) => {
      log.push(`p1:${frame.kind}`)
      return frame
    })

    const p2: Processor = mapProcessor((frame) => {
      log.push(`p2:${frame.kind}`)
      return frame
    })

    const pipeline = createPipeline({ processors: [p1, p2] })
    const input = [createFrame('cancel')]
    await collectFrames(pipeline(fromFrames(input)))

    expect(log).toEqual(['p1:cancel', 'p2:cancel'])
  })

  it('supports processor that expands frames (downstream sees expanded)', async () => {
    // p1 expands user-text into text + delta
    const p1: Processor = mapProcessor((frame) => {
      if (frame.kind === 'user-text') {
        return [
          frame,
          createFrame('agent-text-delta', { delta: 'reply', accumulatedText: 'reply' }),
        ]
      }
      return frame
    })

    // p2 collects all frame kinds
    const seen: string[] = []
    const p2: Processor = mapProcessor((frame) => {
      seen.push(frame.kind)
      return frame
    })

    const pipeline = createPipeline({ processors: [p1, p2] })
    const input = [createFrame('user-text', { text: 'q', entryId: 'e1' })]
    const output = await collectFrames(pipeline(fromFrames(input)))

    expect(seen).toEqual(['user-text', 'agent-text-delta'])
    expect(output).toHaveLength(2)
  })

  it('supports processor that filters frames', async () => {
    const filterCancel: Processor = mapProcessor((frame) =>
      frame.kind === 'cancel' ? null : frame,
    )

    const pipeline = createPipeline({ processors: [filterCancel] })
    const input = [
      createFrame('user-text', { text: 'q', entryId: 'e1' }),
      createFrame('cancel'),
      createFrame('tts-speaking-start'),
    ]
    const output = await collectFrames(pipeline(fromFrames(input)))

    expect(output).toHaveLength(2)
    expect(output.map((f) => f.kind)).toEqual(['user-text', 'tts-speaking-start'])
  })

  it('works with empty processor list (passthrough)', async () => {
    const pipeline = createPipeline({ processors: [] })
    const input = [createFrame('cancel'), createFrame('tts-speaking-end')]
    const output = await collectFrames(pipeline(fromFrames(input)))

    expect(output).toHaveLength(2)
  })

  it('preserves frame ordering across multiple processors', async () => {
    const ids: number[] = []

    // p1 passes through, p2 records frame IDs
    const p1: Processor = mapProcessor((f) => f)
    const p2: Processor = mapProcessor((frame) => {
      ids.push(frame.id)
      return frame
    })

    const pipeline = createPipeline({ processors: [p1, p2] })

    // Create sequential frames
    resetFrameIds()
    const frames = [
      createFrame('cancel'), // id=0
      createFrame('cancel'), // id=1
      createFrame('cancel'), // id=2
    ]

    await collectFrames(pipeline(fromFrames(frames)))

    expect(ids).toEqual([0, 1, 2])
  })
})
