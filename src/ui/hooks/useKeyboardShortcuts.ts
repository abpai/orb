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
  // A single subscription dispatches every shortcut. It must stay `isActive: true`
  // so Ctrl-C exits even when the app is otherwise disabled; per-shortcut guards
  // below reproduce the enable/can* conditions each subscription used to carry.
  useInput((input, key) => {
    // Ctrl-C exits unconditionally, ignoring `enabled`.
    if (key.ctrl && input === 'c') {
      process.exit(0)
    }

    if (!enabled) return

    // Cancel an in-flight turn via Esc or Ctrl-S. The `@`-file menu owns Esc while
    // open (it dismisses itself), so don't also cancel; Ctrl-S still cancels.
    if (state !== 'idle') {
      if (key.escape && menuOpen) {
        // menu owns Esc — fall through to the other shortcuts below.
      } else if (key.escape || (key.ctrl && input === 's')) {
        onCancel()
      }
    }

    if (key.ctrl && input === 'o') {
      onToggleDetailMode()
    }

    if (canTogglePause && key.ctrl && input === 'p') {
      onTogglePause()
    }

    if (canRepeat && key.ctrl && input === 'r') {
      onRepeat()
    }

    if (canOpenFiles && key.ctrl && input === 'g') {
      onOpenFiles()
    }

    if (canCycleModel) {
      const isShiftTab =
        (key.shift && key.tab) || input === '\u001b[Z' || (key.shift && input === '\t')
      if (isShiftTab) {
        onCycleModel()
      }
    }
  })
}
