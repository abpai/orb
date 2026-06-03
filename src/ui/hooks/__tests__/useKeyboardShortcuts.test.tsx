import { describe, expect, it, mock } from 'bun:test'
import { Text } from 'ink'
import { render } from 'ink-testing-library'

import { settle } from '../../__tests__/test-utils'
import { useKeyboardShortcuts } from '../useKeyboardShortcuts'

function Harness({ onCancel, menuOpen }: { onCancel: () => void; menuOpen: boolean }) {
  useKeyboardShortcuts({
    canCycleModel: false,
    canOpenFiles: false,
    canRepeat: false,
    canTogglePause: false,
    menuOpen,
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
  it('cancels the turn on Esc when the @-menu is closed', async () => {
    const onCancel = mock(() => {})
    const app = render(<Harness onCancel={onCancel} menuOpen={false} />)
    await settle()

    app.stdin.write('\x1b') // Esc
    await settle()

    expect(onCancel).toHaveBeenCalledTimes(1)
    app.unmount()
  })

  it('lets the menu own Esc without cancelling the turn when it is open', async () => {
    const onCancel = mock(() => {})
    const app = render(<Harness onCancel={onCancel} menuOpen={true} />)
    await settle()

    app.stdin.write('\x1b') // Esc — menu dismisses itself; turn must survive
    await settle()

    expect(onCancel).not.toHaveBeenCalled()
    app.unmount()
  })
})
