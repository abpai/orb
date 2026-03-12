import type { Transport } from './types'
import { createTerminalTextTransport } from './terminal-text'

export type TransportType = 'terminal-text'

export function createTransport(type: TransportType = 'terminal-text'): Transport {
  switch (type) {
    case 'terminal-text':
      return createTerminalTextTransport()
  }
}

export type { Transport, InboundEvent, OutboundFrame } from './types'
