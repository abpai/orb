import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'

interface InputPromptProps {
  onSubmit: (value: string) => void
  disabled: boolean
}

function Cursor({ visible }: { visible: boolean }): React.ReactNode {
  if (!visible) return null
  return <Text backgroundColor="white"> </Text>
}

export function InputPrompt({ onSubmit, disabled }: InputPromptProps): React.ReactNode {
  const [value, setValue] = useState('')
  const [cursorVisible, setCursorVisible] = useState(true)

  useEffect(() => {
    if (disabled) return
    const interval = setInterval(() => setCursorVisible((v) => !v), 530)
    return () => clearInterval(interval)
  }, [disabled])

  useInput(
    (input, key) => {
      if (key.return) {
        const trimmed = value.trim()
        if (trimmed) {
          onSubmit(trimmed)
          setValue('')
        }
        return
      }

      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1))
        return
      }

      if (input && !key.ctrl && !key.meta) {
        setValue((v) => v + input)
      }
    },
    { isActive: !disabled },
  )

  const promptColor = disabled ? 'gray' : 'cyan'

  if (disabled) {
    return (
      <Box marginTop={1}>
        <Text color={promptColor}>❯ </Text>
        <Text color="gray">{value || '...'}</Text>
      </Box>
    )
  }

  return (
    <Box marginTop={1}>
      <Text color={promptColor}>❯ </Text>
      <Text>
        {value}
        <Cursor visible={cursorVisible} />
      </Text>
    </Box>
  )
}
