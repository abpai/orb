import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'

import { extractSlashCommandName, listAvailableSlashCommands } from '../../services/commands'
import type { AppState } from '../../types'
import { keyToAction } from '../input/keymap'
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
import { MicroOrb } from './MicroOrb'

interface InputPromptProps {
  onSubmit: (value: string) => void
  onEdit?: () => void
  state: AppState
  projectPath?: string
  homeDir?: string
}

interface CycleState {
  matches: string[]
  index: number
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
}: InputPromptProps) {
  const [buffer, setBuffer] = useState<TextBufferState>(() => empty())
  // Mirror of `buffer` for the useInput callback. Ink can fire stdin events
  // multiple times per tick (chunked paste), so the closure's `buffer` goes
  // stale before React commits — and `submit` needs a synchronous read that a
  // setState updater can't provide without doing side effects in the updater.
  const bufferRef = useRef(buffer)
  const desiredColRef = useRef(0)
  const commandNamesRef = useRef<string[]>([])
  const cycleRef = useRef<CycleState | null>(null)

  useEffect(() => {
    let cancelled = false
    commandNamesRef.current = []
    cycleRef.current = null

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
  }, [projectPath, homeDir])

  const apply = useCallback(
    (
      update: (current: TextBufferState) => TextBufferState,
      options: { notifyEdit?: boolean; resetDesiredCol?: boolean } = {},
    ) => {
      const next = update(bufferRef.current)
      if (options.resetDesiredCol ?? true) desiredColRef.current = next.col
      if (next === bufferRef.current) return false
      if (options.notifyEdit) onEdit?.()
      bufferRef.current = next
      setBuffer(next)
      return true
    },
    [onEdit],
  )

  const handleComplete = useCallback(() => {
    const buf = bufferRef.current
    if (buf.row !== 0) return

    // Cycling replaces the whole command name, so the cursor can sit anywhere —
    // skip the cursor-position guard used for the initial completion below.
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
  }, [apply])

  useInput((input, key) => {
    const action = keyToAction(input, key)
    if (action.kind !== 'complete') cycleRef.current = null

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
