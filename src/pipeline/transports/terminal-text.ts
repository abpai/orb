import type { Transport, InboundEvent, OutboundFrame } from './types'

type InboundListener = (event: InboundEvent) => void
type OutboundListener = (frame: OutboundFrame) => void

/**
 * In-memory transport for same-process terminal UI.
 * Synchronous dispatch — both pipeline and React UI live in the same Bun process.
 */
export function createTerminalTextTransport(): Transport {
  const inboundListeners = new Set<InboundListener>()
  const outboundListeners = new Set<OutboundListener>()

  return {
    onInbound(listener: InboundListener): () => void {
      inboundListeners.add(listener)
      return () => inboundListeners.delete(listener)
    },

    emitInbound(event: InboundEvent): void {
      for (const listener of inboundListeners) {
        listener(event)
      }
    },

    onOutbound(listener: OutboundListener): () => void {
      outboundListeners.add(listener)
      return () => outboundListeners.delete(listener)
    },

    sendOutbound(frame: OutboundFrame): void {
      for (const listener of outboundListeners) {
        listener(frame)
      }
    },

    dispose(): void {
      inboundListeners.clear()
      outboundListeners.clear()
    },
  }
}
