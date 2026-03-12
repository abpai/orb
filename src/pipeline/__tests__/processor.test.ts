import { describe, expect, it, beforeEach } from 'bun:test'
import { createFrame, resetFrameIds, type Frame } from '../frames'
import { createProcessor, type Processor } from '../processor'

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

describe('createProcessor', () => {
  beforeEach(() => {
    resetFrameIds()
  })

  it('passes frames through when handler returns the frame', async () => {
    const passThrough: Processor = createProcessor((frame) => frame)
    const input = [createFrame('cancel'), createFrame('tts-speaking-start')]
    const output = await collectFrames(passThrough(fromFrames(input)))

    expect(output).toHaveLength(2)
    expect(output[0]!.kind).toBe('cancel')
    expect(output[1]!.kind).toBe('tts-speaking-start')
  })

  it('filters frames when handler returns null', async () => {
    const filterCancel: Processor = createProcessor((frame) =>
      frame.kind === 'cancel' ? null : frame,
    )
    const input = [createFrame('cancel'), createFrame('tts-speaking-start'), createFrame('cancel')]
    const output = await collectFrames(filterCancel(fromFrames(input)))

    expect(output).toHaveLength(1)
    expect(output[0]!.kind).toBe('tts-speaking-start')
  })

  it('expands one frame into multiple', async () => {
    const expander: Processor = createProcessor((frame) => {
      if (frame.kind === 'user-text') {
        return [
          frame,
          createFrame('agent-text-delta', { delta: frame.text, accumulatedText: frame.text }),
        ]
      }
      return frame
    })

    const input = [createFrame('user-text', { text: 'hello', entryId: 'e1' })]
    const output = await collectFrames(expander(fromFrames(input)))

    expect(output).toHaveLength(2)
    expect(output[0]!.kind).toBe('user-text')
    expect(output[1]!.kind).toBe('agent-text-delta')
  })

  it('supports async iterable return from handler', async () => {
    const asyncExpander: Processor = createProcessor((frame) => {
      if (frame.kind === 'user-text') {
        return (async function* () {
          yield frame
          yield createFrame('agent-text-delta', { delta: 'a', accumulatedText: 'a' })
          yield createFrame('agent-text-delta', { delta: 'b', accumulatedText: 'ab' })
        })()
      }
      return frame
    })

    const input = [createFrame('user-text', { text: 'q', entryId: 'e1' })]
    const output = await collectFrames(asyncExpander(fromFrames(input)))

    expect(output).toHaveLength(3)
    expect(output[0]!.kind).toBe('user-text')
    expect(output[1]!.kind).toBe('agent-text-delta')
    expect(output[2]!.kind).toBe('agent-text-delta')
  })

  it('calls onInit and onDestroy', async () => {
    let inited = false
    let destroyed = false

    const processor: Processor = createProcessor((frame) => frame, {
      onInit: () => {
        inited = true
      },
      onDestroy: () => {
        destroyed = true
      },
    })

    const input = [createFrame('cancel')]
    await collectFrames(processor(fromFrames(input)))

    expect(inited).toBe(true)
    expect(destroyed).toBe(true)
  })
})
