import { afterEach, describe, expect, it } from 'bun:test'
import { render } from 'ink-testing-library'

import { useTerminalSize } from './useTerminalSize'

const originalStdoutTty = process.stdout.isTTY

function setStdoutTty(enabled: boolean) {
  Object.defineProperty(process.stdout, 'isTTY', { value: enabled, configurable: true })
}

function Consumer() {
  useTerminalSize()
  return null
}

function Harness({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => <Consumer key={index} />)
}

afterEach(() => {
  setStdoutTty(originalStdoutTty)
})

describe('useTerminalSize', () => {
  it('shares a single resize listener across many consumers and cleans it up', async () => {
    setStdoutTty(true)
    const baselineListeners = process.stdout.listenerCount('resize')

    const app = render(<Harness count={12} />)
    await Bun.sleep(0)

    expect(process.stdout.listenerCount('resize')).toBe(baselineListeners + 1)

    app.unmount()
    await Bun.sleep(0)

    expect(process.stdout.listenerCount('resize')).toBe(baselineListeners)
  })
})
