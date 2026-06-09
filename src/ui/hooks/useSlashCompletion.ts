import { useEffect, useRef } from 'react'
import { listAvailableSlashCommands } from '../../services/commands'

export interface SlashCompletion {
  commandNamesRef: React.RefObject<string[]>
}

export function useSlashCompletion({
  projectPath,
  homeDir,
  onClearCycle,
}: {
  projectPath?: string
  homeDir?: string
  onClearCycle: () => void
}): SlashCompletion {
  const commandNamesRef = useRef<string[]>([])

  useEffect(() => {
    let cancelled = false
    commandNamesRef.current = []
    onClearCycle()

    if (!projectPath) return

    void listAvailableSlashCommands({ projectPath, homeDir })
      .then((commands) => {
        if (cancelled) return
        commandNamesRef.current = commands.map((command) => command.name)
      })
      .catch(() => {
        /* tab-complete is best-effort; ignore load failures */
      })
    return () => {
      cancelled = true
    }
  }, [projectPath, homeDir, onClearCycle])

  return { commandNamesRef }
}
