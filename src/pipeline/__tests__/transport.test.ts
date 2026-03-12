import { describe, expect, it } from 'bun:test'
import { createTerminalTextTransport } from '../transports/terminal-text'
import { createFrame, resetFrameIds } from '../frames'
import type { InboundEvent, OutboundFrame } from '../transports/types'

describe('createTerminalTextTransport', () => {
  it('dispatches inbound events to listeners', () => {
    const transport = createTerminalTextTransport()
    const received: InboundEvent[] = []

    transport.onInbound((event) => received.push(event))
    transport.emitInbound({ kind: 'submit', query: 'hello' })
    transport.emitInbound({ kind: 'cancel' })

    expect(received).toHaveLength(2)
    expect(received[0]!.kind).toBe('submit')
    expect(received[1]!.kind).toBe('cancel')
  })

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

    transport.onInbound(() => count1++)
    transport.onInbound(() => count2++)
    transport.emitInbound({ kind: 'cancel' })

    expect(count1).toBe(1)
    expect(count2).toBe(1)
  })

  it('unsubscribes listeners via returned function', () => {
    const transport = createTerminalTextTransport()
    let count = 0

    const unsub = transport.onInbound(() => count++)
    transport.emitInbound({ kind: 'cancel' })
    expect(count).toBe(1)

    unsub()
    transport.emitInbound({ kind: 'cancel' })
    expect(count).toBe(1) // not incremented
  })

  it('dispose clears all listeners', () => {
    const transport = createTerminalTextTransport()
    let inCount = 0
    let outCount = 0

    transport.onInbound(() => inCount++)
    transport.onOutbound(() => outCount++)

    transport.dispose()

    transport.emitInbound({ kind: 'cancel' })
    transport.sendOutbound(
      createFrame('agent-text-delta', { delta: 'x', accumulatedText: 'x' }) as OutboundFrame,
    )

    expect(inCount).toBe(0)
    expect(outCount).toBe(0)
  })
})
