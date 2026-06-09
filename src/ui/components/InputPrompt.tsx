import { memo, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

import { extractSlashCommandName } from '../../services/commands'
import type { AppState } from '../../types'
import { useFileMentionMenu } from '../hooks/useFileMentionMenu'
import { useSlashCompletion } from '../hooks/useSlashCompletion'
import { useTextBufferInput } from '../hooks/useTextBufferInput'
import { keyToAction } from '../input/keymap'
import { applyMention, findActiveMention } from '../input/mention'
import { sanitizePaste } from '../input/paste'
import {
  backspace,
  deleteWordLeft,
  empty,
  insert,
  killLine,
  killToLineEnd,
  moveDown,
  moveEnd,
  moveHome,
  moveLeft,
  moveRight,
  moveUp,
  moveWordLeft,
  moveWordRight,
  newline,
  toString,
  type TextBufferState,
} from '../input/TextBuffer'
import { FileMenu } from './FileMenu'
import { MicroOrb } from './MicroOrb'

interface InputPromptProps {
  onSubmit: (value: string) => void
  onEdit?: () => void
  state: AppState
  projectPath?: string
  homeDir?: string
  /** Notified when the `@`-file menu opens or closes, so the global Esc
   * handler can let the menu own Esc instead of cancelling the turn. */
  onMenuOpenChange?: (open: boolean) => void
}

function applyCompletion(buffer: TextBufferState, newCommand: string): TextBufferState {
  const line = buffer.lines[0] ?? ''
  const currentName = extractSlashCommandName(line) ?? ''
  const rest = line.slice(1 + currentName.length)
  const hadTrailing = rest.length > 0
  const tail = hadTrailing ? rest : ' '
  const newLine = `/${newCommand}${tail}`
  const newCol = 1 + newCommand.length + (hadTrailing ? 0 : 1)
  return {
    lines: [newLine, ...buffer.lines.slice(1)],
    row: 0,
    col: newCol,
  }
}

export const InputPrompt = memo(function InputPrompt({
  onSubmit,
  onEdit,
  state,
  projectPath,
  homeDir,
  onMenuOpenChange,
}: InputPromptProps) {
  const { buffer, bufferRef, desiredColRef, cycleRef, update } = useTextBufferInput()

  const { menu, menuRef, setMenuState, closeMenu, refreshMenu } = useFileMentionMenu({
    projectPath,
    bufferRef,
    onMenuOpenChange,
  })

  const clearCycle = useCallback(() => {
    cycleRef.current = null
  }, [cycleRef])

  const { commandNamesRef } = useSlashCompletion({ projectPath, homeDir, onClearCycle: clearCycle })

  const apply = useCallback(
    (
      fn: (current: TextBufferState) => TextBufferState,
      options: { notifyEdit?: boolean; resetDesiredCol?: boolean } = {},
    ) => {
      if (options.notifyEdit) onEdit?.()
      const next = update(fn, { resetDesiredCol: options.resetDesiredCol })
      if (!next) return false
      if (menuRef.current !== null || next.lines.some((l) => l.includes('@'))) {
        refreshMenu(next)
      } else {
        closeMenu()
      }
      return true
    },
    [onEdit, update, menuRef, refreshMenu, closeMenu],
  )

  const acceptMention = useCallback(() => {
    const current = menuRef.current
    if (!current || current.items.length === 0) return
    const choice = current.items[current.index]
    if (!choice) return
    const buf = bufferRef.current
    const line = buf.lines[buf.row] ?? ''
    const mention = findActiveMention(line, buf.col)
    if (!mention) {
      closeMenu()
      return
    }
    apply((b) => applyMention(b, mention.start, choice), { notifyEdit: true })
    closeMenu()
  }, [apply, closeMenu, menuRef, bufferRef])

  const handleComplete = useCallback(() => {
    const buf = bufferRef.current
    if (buf.row !== 0) return

    const cycle = cycleRef.current
    if (cycle && cycle.matches.length > 1) {
      const nextIndex = (cycle.index + 1) % cycle.matches.length
      cycleRef.current = { ...cycle, index: nextIndex }
      apply((current) => applyCompletion(current, cycle.matches[nextIndex]!), { notifyEdit: true })
      return
    }

    const line = buf.lines[0] ?? ''
    const currentName = extractSlashCommandName(line)
    if (currentName === null) return
    const commandEnd = 1 + currentName.length
    if (buf.col > commandEnd) return

    const prefix = currentName.toLowerCase()
    const matches = commandNamesRef.current.filter((name) => name.toLowerCase().startsWith(prefix))
    if (matches.length === 0) return

    apply((current) => applyCompletion(current, matches[0]!), { notifyEdit: true })
    cycleRef.current = matches.length > 1 ? { matches, index: 0 } : null
  }, [apply, bufferRef, commandNamesRef, cycleRef])

  useInput((input, key) => {
    const action = keyToAction(input, key)
    if (action.kind !== 'complete') cycleRef.current = null

    const openMenu = menuRef.current
    if (openMenu && openMenu.items.length > 0) {
      const count = openMenu.items.length
      switch (action.kind) {
        case 'move-up':
          return setMenuState({ ...openMenu, index: (openMenu.index - 1 + count) % count })
        case 'move-down':
          return setMenuState({ ...openMenu, index: (openMenu.index + 1) % count })
        case 'submit':
        case 'complete':
          return acceptMention()
        case 'dismiss':
          return closeMenu()
      }
    } else if (action.kind === 'dismiss') {
      return
    }

    switch (action.kind) {
      case 'submit': {
        const text = toString(bufferRef.current).trim()
        if (text.length === 0) return
        onSubmit(text)
        apply(empty)
        return
      }
      case 'newline':
        return apply(newline, { notifyEdit: true })
      case 'backspace':
        return apply(backspace, { notifyEdit: true })
      case 'move-left':
        return apply(moveLeft)
      case 'move-right':
        return apply(moveRight)
      case 'move-word-left':
        return apply(moveWordLeft)
      case 'move-word-right':
        return apply(moveWordRight)
      case 'move-up':
        return apply((current) => moveUp(current, desiredColRef.current), {
          resetDesiredCol: false,
        })
      case 'move-down':
        return apply((current) => moveDown(current, desiredColRef.current), {
          resetDesiredCol: false,
        })
      case 'move-home':
        return apply(moveHome)
      case 'move-end':
        return apply(moveEnd)
      case 'delete-word-left':
        return apply(deleteWordLeft, { notifyEdit: true })
      case 'kill-to-line-end':
        return apply(killToLineEnd, { notifyEdit: true })
      case 'kill-line':
        return apply(killLine, { notifyEdit: true })
      case 'complete':
        return handleComplete()
      case 'insert': {
        const text = action.text.length > 1 ? sanitizePaste(action.text) : action.text
        if (text.length === 0) return
        return apply((current) => insert(current, text), { notifyEdit: true })
      }
      case 'ignore':
        return
    }
  })

  return (
    <Box flexDirection="column">
      {buffer.lines.map((line, idx) => (
        <InputLine
          key={idx}
          line={line}
          isFirst={idx === 0}
          state={state}
          cursor={idx === buffer.row ? buffer.col : null}
        />
      ))}
      {menu && <FileMenu items={menu.items} selected={menu.index} />}
    </Box>
  )
})

interface InputLineProps {
  line: string
  isFirst: boolean
  state: AppState
  cursor: number | null
}

function InputLine({ line, isFirst, state, cursor }: InputLineProps) {
  return (
    <Text>
      {isFirst ? <MicroOrb state={state} /> : <Text> </Text>}
      <Text color="cyan">{isFirst ? ' ❯ ' : '   '}</Text>
      {cursor !== null ? <CursorLine line={line} col={cursor} /> : <Text>{line}</Text>}
    </Text>
  )
}

function CursorLine({ line, col }: { line: string; col: number }) {
  const before = line.slice(0, col)
  const cursorChar = col < line.length ? line[col]! : ' '
  const after = col < line.length ? line.slice(col + 1) : ''
  return (
    <>
      <Text>{before}</Text>
      <Text inverse>{cursorChar}</Text>
      <Text>{after}</Text>
    </>
  )
}
