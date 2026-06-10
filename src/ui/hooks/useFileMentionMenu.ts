import { useCallback, useEffect, useRef, useState } from 'react'
import { searchProjectFiles } from '../../services/file-search'
import { findActiveMention } from '../input/mention'
import type { TextBufferState } from '../input/TextBuffer'

export interface MenuState {
  items: string[]
  index: number
}

export interface FileMentionMenu {
  menu: MenuState | null
  menuRef: React.RefObject<MenuState | null>
  setMenuState: (next: MenuState | null) => void
  closeMenu: () => void
  refreshMenu: (buffer: TextBufferState) => void
}

const FILE_MENTION_SEARCH_DELAY_MS = 40

export function useFileMentionMenu({
  projectPath,
  bufferRef,
  onMenuOpenChange,
}: {
  projectPath?: string
  bufferRef: React.RefObject<TextBufferState>
  onMenuOpenChange?: (open: boolean) => void
}): FileMentionMenu {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<MenuState | null>(null)
  const searchSeqRef = useRef(0)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearSearchTimer = useCallback(() => {
    const timer = searchTimerRef.current
    if (timer === null) return
    clearTimeout(timer)
    searchTimerRef.current = null
  }, [])

  const setMenuState = useCallback(
    (next: MenuState | null) => {
      const wasOpen = menuRef.current !== null
      const isOpen = next !== null
      menuRef.current = next
      if (isOpen !== wasOpen) onMenuOpenChange?.(isOpen)
      setMenu(next)
    },
    [onMenuOpenChange],
  )

  useEffect(
    () => () => {
      clearSearchTimer()
      onMenuOpenChange?.(false)
    },
    [clearSearchTimer, onMenuOpenChange],
  )

  const closeMenu = useCallback(() => {
    clearSearchTimer()
    searchSeqRef.current++
    if (menuRef.current !== null) setMenuState(null)
  }, [clearSearchTimer, setMenuState])

  const refreshMenu = useCallback(
    (buffer: TextBufferState) => {
      if (!projectPath) {
        closeMenu()
        return
      }
      const line = buffer.lines[buffer.row] ?? ''
      const mention = findActiveMention(line, buffer.col)
      if (!mention) {
        closeMenu()
        return
      }
      const seq = ++searchSeqRef.current
      const expected = { row: buffer.row, start: mention.start, query: mention.query }
      clearSearchTimer()
      searchTimerRef.current = setTimeout(() => {
        searchTimerRef.current = null
        void searchProjectFiles(mention.query, { projectPath })
          .then((items) => {
            if (seq !== searchSeqRef.current) return
            const live = bufferRef.current
            const liveLine = live.lines[live.row] ?? ''
            const liveMention = findActiveMention(liveLine, live.col)
            if (
              !liveMention ||
              live.row !== expected.row ||
              liveMention.start !== expected.start ||
              liveMention.query !== expected.query
            ) {
              return
            }
            setMenuState(items.length > 0 ? { items, index: 0 } : null)
          })
          .catch(() => {
            /* search is best-effort; leave the menu as-is */
          })
      }, FILE_MENTION_SEARCH_DELAY_MS)
    },
    [projectPath, closeMenu, clearSearchTimer, setMenuState, bufferRef],
  )

  return { menu, menuRef, setMenuState, closeMenu, refreshMenu }
}
