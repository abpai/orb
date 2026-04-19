import React, { memo, useCallback, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'

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
  state: AppState
}

export const InputPrompt = memo(function InputPrompt({ onSubmit, state }: InputPromptProps) {
  const [buffer, setBuffer] = useState<TextBufferState>(() => empty())
  // Mirror of `buffer` for the useInput callback. Ink can fire stdin events
  // multiple times per tick (chunked paste), so the closure's `buffer` goes
  // stale before React commits — and `submit` needs a synchronous read that a
  // setState updater can't provide without doing side effects in the updater.
  const bufferRef = useRef(buffer)
  const desiredColRef = useRef(0)

  const apply = useCallback(
    (update: (current: TextBufferState) => TextBufferState, resetDesiredCol = true) => {
      const next = update(bufferRef.current)
      if (resetDesiredCol) desiredColRef.current = next.col
      if (next === bufferRef.current) return
      bufferRef.current = next
      setBuffer(next)
    },
    [],
  )

  useInput((input, key) => {
    const action = keyToAction(input, key)
    switch (action.kind) {
      case 'submit': {
        const text = toString(bufferRef.current).trim()
        if (text.length === 0) return
        onSubmit(text)
        apply(empty)
        return
      }
      case 'newline':
        return apply(newline)
      case 'backspace':
        return apply(backspace)
      case 'move-left':
        return apply(moveLeft)
      case 'move-right':
        return apply(moveRight)
      case 'move-word-left':
        return apply(moveWordLeft)
      case 'move-word-right':
        return apply(moveWordRight)
      case 'move-up':
        return apply((current) => moveUp(current, desiredColRef.current), false)
      case 'move-down':
        return apply((current) => moveDown(current, desiredColRef.current), false)
      case 'move-home':
        return apply(moveHome)
      case 'move-end':
        return apply(moveEnd)
      case 'delete-word-left':
        return apply(deleteWordLeft)
      case 'kill-to-line-end':
        return apply(killToLineEnd)
      case 'kill-line':
        return apply(killLine)
      case 'insert': {
        const text = action.text.length > 1 ? sanitizePaste(action.text) : action.text
        if (text.length === 0) return
        return apply((current) => insert(current, text))
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
