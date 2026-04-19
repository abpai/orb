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
  const [buffer, setBuffer] = useState<TextBufferState>(empty)
  const desiredColRef = useRef(0)

  const apply = useCallback((next: TextBufferState, resetDesiredCol = true) => {
    setBuffer(next)
    if (resetDesiredCol) desiredColRef.current = next.col
  }, [])

  useInput((input, key) => {
    const action = keyToAction(input, key)
    switch (action.kind) {
      case 'submit': {
        const text = toString(buffer).trim()
        if (text.length === 0) return
        onSubmit(text)
        setBuffer(empty())
        desiredColRef.current = 0
        return
      }
      case 'newline':
        return apply(newline(buffer))
      case 'backspace':
        return apply(backspace(buffer))
      case 'move-left':
        return apply(moveLeft(buffer))
      case 'move-right':
        return apply(moveRight(buffer))
      case 'move-word-left':
        return apply(moveWordLeft(buffer))
      case 'move-word-right':
        return apply(moveWordRight(buffer))
      case 'move-up':
        return apply(moveUp(buffer, desiredColRef.current), false)
      case 'move-down':
        return apply(moveDown(buffer, desiredColRef.current), false)
      case 'move-home':
        return apply(moveHome(buffer))
      case 'move-end':
        return apply(moveEnd(buffer))
      case 'delete-word-left':
        return apply(deleteWordLeft(buffer))
      case 'kill-to-line-end':
        return apply(killToLineEnd(buffer))
      case 'kill-line':
        return apply(killLine(buffer))
      case 'insert': {
        const text = action.text.length > 1 ? sanitizePaste(action.text) : action.text
        if (text.length === 0) return
        return apply(insert(buffer, text))
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
