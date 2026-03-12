import { describe, expect, it, beforeEach } from 'bun:test'
import { createFrame, resetFrameIds, type Frame } from '../frames'

describe('createFrame', () => {
  beforeEach(() => {
    resetFrameIds()
  })

  it('creates frames with auto-incrementing IDs', () => {
    const f1 = createFrame('cancel')
    const f2 = createFrame('cancel')
    expect(f1.id).toBe(0)
    expect(f2.id).toBe(1)
  })

  it('sets timestamps', () => {
    const before = Date.now()
    const frame = createFrame('cancel')
    const after = Date.now()
    expect(frame.timestamp).toBeGreaterThanOrEqual(before)
    expect(frame.timestamp).toBeLessThanOrEqual(after)
  })

  it('creates user-text frame with data', () => {
    const frame = createFrame('user-text', { text: 'hello', entryId: 'e1' })
    expect(frame.kind).toBe('user-text')
    expect(frame.text).toBe('hello')
    expect(frame.entryId).toBe('e1')
  })

  it('creates agent-text-delta frame with accumulated text', () => {
    const frame = createFrame('agent-text-delta', {
      delta: 'chunk',
      accumulatedText: 'full chunk',
    })
    expect(frame.kind).toBe('agent-text-delta')
    expect(frame.delta).toBe('chunk')
    expect(frame.accumulatedText).toBe('full chunk')
  })

  it('creates tool-call-start frame with tool call data', () => {
    const frame = createFrame('tool-call-start', {
      toolCall: {
        id: 't1',
        index: 0,
        name: 'bash',
        input: { command: 'ls' },
        status: 'running',
      },
    })
    expect(frame.kind).toBe('tool-call-start')
    expect(frame.toolCall.name).toBe('bash')
    expect(frame.toolCall.input).toEqual({ command: 'ls' })
  })

  it('creates tts-pending frame with handles', () => {
    let stopped = false
    const frame = createFrame('tts-pending', {
      waitForCompletion: () => Promise.resolve(),
      stop: () => {
        stopped = true
      },
    })
    expect(frame.kind).toBe('tts-pending')
    frame.stop()
    expect(stopped).toBe(true)
  })

  it('creates data-less frames without second argument', () => {
    const cancel = createFrame('cancel')
    expect(cancel.kind).toBe('cancel')

    const ttsStart = createFrame('tts-speaking-start')
    expect(ttsStart.kind).toBe('tts-speaking-start')

    const ttsEnd = createFrame('tts-speaking-end')
    expect(ttsEnd.kind).toBe('tts-speaking-end')
  })

  it('discriminated union narrows correctly', () => {
    const frame: Frame = createFrame('agent-text-delta', {
      delta: 'hi',
      accumulatedText: 'hi',
    })

    if (frame.kind === 'agent-text-delta') {
      // TypeScript narrows to AgentTextDeltaFrame
      expect(frame.delta).toBe('hi')
      expect(frame.accumulatedText).toBe('hi')
    } else {
      throw new Error('Should have narrowed to agent-text-delta')
    }
  })
})
