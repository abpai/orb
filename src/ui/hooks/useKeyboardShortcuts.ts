import { useInput } from 'ink'

import type { AppState } from '../../types'
import { isMentionMenuOpen } from '../input/mention-menu-state'

interface UseKeyboardShortcutsConfig {
  canCycleModel: boolean
  canOpenFiles: boolean
  canRepeat: boolean
  canTogglePause: boolean
  onCancel(): void
  onCycleModel(): void
  onOpenFiles(): void
  onRepeat(): void
  onToggleDetailMode(): void
  onTogglePause(): void
  state: AppState
}

export function useKeyboardShortcuts({
  canCycleModel,
  canOpenFiles,
  canRepeat,
  canTogglePause,
  onCancel,
  onCycleModel,
  onOpenFiles,
  onRepeat,
  onToggleDetailMode,
  onTogglePause,
  state,
}: UseKeyboardShortcutsConfig) {
  useInput(
    (input, key) => {
      // The `@`-file menu owns Esc while it's open (it dismisses itself); don't
      // also cancel the in-flight turn. Ctrl-S still cancels unconditionally.
      if (key.escape && isMentionMenuOpen()) return
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
      if (key.ctrl && input === 'p') {
        onTogglePause()
      }
    },
    { isActive: canTogglePause },
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'r') {
        onRepeat()
      }
    },
    { isActive: canRepeat },
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'g') {
        onOpenFiles()
      }
    },
    { isActive: canOpenFiles },
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
