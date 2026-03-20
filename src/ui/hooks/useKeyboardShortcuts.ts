import { useInput } from 'ink'

import type { AppState } from '../../types'

interface UseKeyboardShortcutsConfig {
  canCycleModel: boolean
  onCancel(): void
  onCycleModel(): void
  onToggleDetailMode(): void
  state: AppState
}

export function useKeyboardShortcuts({
  canCycleModel,
  onCancel,
  onCycleModel,
  onToggleDetailMode,
  state,
}: UseKeyboardShortcutsConfig) {
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === 's')) {
        onCancel()
      }
    },
    { isActive: state !== 'idle' },
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'o') {
        onToggleDetailMode()
      }
    },
    { isActive: true },
  )

  useInput(
    (input, key) => {
      const isShiftTab =
        (key.shift && key.tab) || input === '\u001b[Z' || (key.shift && input === '\t')
      if (isShiftTab) {
        onCycleModel()
      }
    },
    { isActive: canCycleModel },
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        process.exit(0)
      }
    },
    { isActive: true },
  )
}
