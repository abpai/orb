import { afterEach, describe, expect, it, mock } from 'bun:test'
import { Text } from 'ink'
import { render } from 'ink-testing-library'

import { setMentionMenuOpen } from '../../input/mention-menu-state'
import { useKeyboardShortcuts } from '../useKeyboardShortcuts'

// A lone Esc needs Ink's escape-sequence disambiguation timeout to elapse
// before it registers as `key.escape`, so wait long enough for that.
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 20))
}

function Harness({ onCancel }: { onCancel: () => void }) {
  useKeyboardShortcuts({
    canCycleModel: false,
    canOpenFiles: false,
    canRepeat: false,
    canTogglePause: false,
    onCancel,
    onCycleModel: () => {},
    onOpenFiles: () => {},
    onRepeat: () => {},
    onToggleDetailMode: () => {},
    onTogglePause: () => {},
    state: 'processing',
  })
  return <Text>harness</Text>
}

describe('useKeyboardShortcuts Esc handling', () => {
  afterEach(() => setMentionMenuOpen(false))

  it('cancels the turn on Esc when the @-menu is closed', async () => {
    const onCancel = mock(() => {})
    const app = render(<Harness onCancel={onCancel} />)
    await settle()

    app.stdin.write('\x1b') // Esc
    await settle()

    expect(onCancel).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it('lets the menu own Esc without cancelling the turn when it is open', async () => {
    const onCancel = mock(() => {})
    setMentionMenuOpen(true)
    const app = render(<Harness onCancel={onCancel} />)
    await settle()

    app.stdin.write('\x1b') // Esc — menu dismisses itself; turn must survive
    await settle()

    expect(onCancel).not.toHaveBeenCalled()
    app.unmount()
  })
})
