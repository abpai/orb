import { useInput } from 'ink'

import type { AppState, ViewMode } from '../../types'

interface UseKeyboardShortcutsConfig {
  canCycleModel: boolean
  onCancel(): void
  onCycleModel(): void
  onOpenTranscript(): void
  state: AppState
  viewMode: ViewMode
}

export function useKeyboardShortcuts({
  canCycleModel,
  onCancel,
  onCycleModel,
  onOpenTranscript,
  state,
  viewMode,
}: UseKeyboardShortcutsConfig) {
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === 's')) {
        onCancel()
      }
    },
    { isActive: viewMode === 'main' && state !== 'idle' },
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'o') {
        onOpenTranscript()
      }
    },
    { isActive: state === 'idle' && viewMode === 'main' },
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
