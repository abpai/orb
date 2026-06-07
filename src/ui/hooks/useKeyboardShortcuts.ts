import { useInput } from 'ink'

import type { AppState } from '../../types'

interface UseKeyboardShortcutsConfig {
  canCycleModel: boolean
  canOpenFiles: boolean
  canRepeat: boolean
  canTogglePause: boolean
  /** When false, app shortcuts are suspended (e.g. while the session picker owns input). */
  enabled?: boolean
  /** Whether the input's `@`-file menu is open; when true it owns Esc. */
  menuOpen: boolean
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
  enabled = true,
  menuOpen,
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
      if (key.escape && menuOpen) return
      if (key.escape || (key.ctrl && input === 's')) {
        onCancel()
      }
    },
    { isActive: enabled && state !== 'idle' },
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'o') {
        onToggleDetailMode()
      }
    },
    { isActive: enabled },
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'p') {
        onTogglePause()
      }
    },
    { isActive: enabled && canTogglePause },
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'r') {
        onRepeat()
      }
    },
    { isActive: enabled && canRepeat },
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'g') {
        onOpenFiles()
      }
    },
    { isActive: enabled && canOpenFiles },
  )

  useInput(
    (input, key) => {
      const isShiftTab =
        (key.shift && key.tab) || input === '\u001b[Z' || (key.shift && input === '\t')
      if (isShiftTab) {
        onCycleModel()
      }
    },
    { isActive: enabled && canCycleModel },
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
