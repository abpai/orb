import type { Transport, OutboundFrame } from './types'

type OutboundListener = (frame: OutboundFrame) => void

/**
 * In-memory transport for same-process terminal UI.
 * Synchronous dispatch — both pipeline and React UI live in the same Bun process.
 */
export function createTerminalTextTransport(): Transport {
  const outboundListeners = new Set<OutboundListener>()

  return {
    onOutbound(listener: OutboundListener): () => void {
      outboundListeners.add(listener)
      return () => outboundListeners.delete(listener)
    },

    sendOutbound(frame: OutboundFrame): void {
      for (const listener of outboundListeners) {
        listener(frame)
      }
    },
  }
}
