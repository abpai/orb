import { describe, expect, it } from 'bun:test'
import { createTerminalTextTransport } from '../transports/terminal-text'
import { createFrame, resetFrameIds } from '../frames'
import type { OutboundFrame } from '../transports/types'

describe('createTerminalTextTransport', () => {
  it('dispatches outbound frames to listeners', () => {
    resetFrameIds()
    const transport = createTerminalTextTransport()
    const received: OutboundFrame[] = []

    transport.onOutbound((frame) => received.push(frame))

    const frame = createFrame('agent-text-delta', {
      delta: 'hi',
      accumulatedText: 'hi',
    }) as OutboundFrame

    transport.sendOutbound(frame)

    expect(received).toHaveLength(1)
    expect(received[0]!.kind).toBe('agent-text-delta')
  })

  it('supports multiple listeners', () => {
    const transport = createTerminalTextTransport()
    let count1 = 0
    let count2 = 0

    transport.onOutbound(() => count1++)
    transport.onOutbound(() => count2++)
    transport.sendOutbound(
      createFrame('agent-text-delta', { delta: 'x', accumulatedText: 'x' }) as OutboundFrame,
    )

    expect(count1).toBe(1)
    expect(count2).toBe(1)
  })

  it('unsubscribes listeners via returned function', () => {
    const transport = createTerminalTextTransport()
    let count = 0

    const unsub = transport.onOutbound(() => count++)
    transport.sendOutbound(
      createFrame('agent-text-delta', { delta: 'x', accumulatedText: 'x' }) as OutboundFrame,
    )
    expect(count).toBe(1)

    unsub()
    transport.sendOutbound(
      createFrame('agent-text-delta', { delta: 'x', accumulatedText: 'x' }) as OutboundFrame,
    )
    expect(count).toBe(1) // not incremented
  })
})
