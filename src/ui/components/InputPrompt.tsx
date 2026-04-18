import React, { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'

import { keyToAction } from '../input/keymap'
import { sanitizePaste } from '../input/paste'
import {
  backspace,
  deleteForward,
  deleteWordLeft,
  empty,
  insert,
  isEmpty,
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

interface InputPromptProps {
  onSubmit: (value: string) => void
  disabled: boolean
  streaming?: boolean
  inline?: boolean
}

const BLINK_INTERVAL_MS = 530
/** After a keystroke, keep the cursor solid for this long before blinking resumes. */
const POST_TYPE_GRACE_MS = 800

export const InputPrompt = memo(function InputPrompt({
  onSubmit,
  disabled,
  streaming = false,
  inline = false,
}: InputPromptProps): React.ReactNode {
  const [buffer, setBuffer] = useState<TextBufferState>(empty)
  const [cursorVisible, setCursorVisible] = useState(true)
  const [typingTick, setTypingTick] = useState(0)
  const desiredColRef = useRef(0)

  // Blink only when idle-focused. A keystroke (via typingTick) restarts the
  // effect so the grace timer delays the next blink, keeping the cursor solid
  // while the user is actively typing.
  useEffect(() => {
    if (disabled || streaming) {
      setCursorVisible(true)
      return
    }
    setCursorVisible(true)
    let intervalId: ReturnType<typeof setInterval> | null = null
    const graceId = setTimeout(() => {
      intervalId = setInterval(() => setCursorVisible((v) => !v), BLINK_INTERVAL_MS)
    }, POST_TYPE_GRACE_MS)
    return () => {
      clearTimeout(graceId)
      if (intervalId) clearInterval(intervalId)
    }
  }, [disabled, streaming, typingTick])

  const bumpTyping = useCallback(() => {
    setTypingTick((t) => t + 1)
  }, [])

  const apply = useCallback(
    (next: TextBufferState, resetDesiredCol = true) => {
      setBuffer(next)
      if (resetDesiredCol) desiredColRef.current = next.col
      bumpTyping()
    },
    [bumpTyping],
  )

  useInput(
    (input, key) => {
      const action = keyToAction(input, key)

      switch (action.kind) {
        case 'submit': {
          const text = toString(buffer).trim()
          if (text.length > 0) {
            onSubmit(text)
            setBuffer(empty())
            desiredColRef.current = 0
            bumpTyping()
          }
          return
        }
        case 'newline':
          apply(newline(buffer))
          return
        case 'backspace':
          apply(backspace(buffer))
          return
        case 'delete-forward':
          apply(deleteForward(buffer))
          return
        case 'move-left':
          apply(moveLeft(buffer))
          return
        case 'move-right':
          apply(moveRight(buffer))
          return
        case 'move-word-left':
          apply(moveWordLeft(buffer))
          return
        case 'move-word-right':
          apply(moveWordRight(buffer))
          return
        case 'move-up':
          // Preserve column across vertical motion.
          apply(moveUp(buffer, desiredColRef.current), false)
          return
        case 'move-down':
          apply(moveDown(buffer, desiredColRef.current), false)
          return
        case 'move-home':
          apply(moveHome(buffer))
          return
        case 'move-end':
          apply(moveEnd(buffer))
          return
        case 'delete-word-left':
          apply(deleteWordLeft(buffer))
          return
        case 'kill-to-line-end':
          apply(killToLineEnd(buffer))
          return
        case 'kill-line':
          apply(killLine(buffer))
          return
        case 'insert': {
          const text = action.text.length > 1 ? sanitizePaste(action.text) : action.text
          if (text.length === 0) return
          apply(insert(buffer, text))
          return
        }
        case 'ignore':
          return
      }
    },
    { isActive: !disabled },
  )

  const promptColor = disabled ? 'gray' : 'cyan'
  const content = disabled
    ? renderDisabled(buffer, promptColor)
    : renderActive(buffer, promptColor, cursorVisible)

  if (inline) return <Box flexDirection="column">{content}</Box>
  return (
    <Box flexDirection="column" marginTop={1}>
      {content}
    </Box>
  )
})

function renderDisabled(buffer: TextBufferState, promptColor: string): React.ReactNode {
  if (isEmpty(buffer)) {
    return (
      <Text>
        <Text color={promptColor}>❯ </Text>
        <Text color="gray">...</Text>
      </Text>
    )
  }
  return buffer.lines.map((line, idx) => (
    <Text key={idx}>
      {idx === 0 ? <Text color={promptColor}>❯ </Text> : <Text color="gray"> </Text>}
      <Text color="gray">{line}</Text>
    </Text>
  ))
}

function renderActive(
  buffer: TextBufferState,
  promptColor: string,
  cursorVisible: boolean,
): React.ReactNode {
  return buffer.lines.map((line, idx) => {
    const prefix = idx === 0 ? <Text color={promptColor}>❯ </Text> : <Text color="gray"> </Text>

    if (idx !== buffer.row) {
      return (
        <Text key={idx}>
          {prefix}
          <Text>{line}</Text>
        </Text>
      )
    }

    const before = line.slice(0, buffer.col)
    const cursorChar = buffer.col < line.length ? line[buffer.col]! : ' '
    const after = buffer.col < line.length ? line.slice(buffer.col + 1) : ''

    return (
      <Text key={idx}>
        {prefix}
        <Text>{before}</Text>
        {cursorVisible ? <Text inverse>{cursorChar}</Text> : <Text>{cursorChar}</Text>}
        <Text>{after}</Text>
      </Text>
    )
  })
}
