import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'

interface InputFieldProps {
  onSubmit: (value: string) => void
  disabled: boolean
  placeholder?: string
}

export function InputField({
  onSubmit,
  disabled,
  placeholder = 'Ask about the codebase...',
}: InputFieldProps) {
  const [value, setValue] = useState('')
  const [cursorVisible, setCursorVisible] = useState(true)

  useEffect(() => {
    if (disabled) return
    const interval = setInterval(() => {
      setCursorVisible((v) => !v)
    }, 530)
    return () => clearInterval(interval)
  }, [disabled])

  useInput(
    (input, key) => {
      if (disabled) return

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

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="gray" dimColor>
        ─────────── Input ───────────
      </Text>
      <Box gap={1}>
        <Text color={disabled ? 'gray' : 'green'}>{'>'}</Text>
        {disabled ? (
          <Text color="gray">{value || '...'}</Text>
        ) : (
          <Text>
            {value || <Text color="gray">{placeholder}</Text>}
            {!value && !cursorVisible ? null : cursorVisible ? (
              <Text backgroundColor="white"> </Text>
            ) : null}
          </Text>
        )}
      </Box>
    </Box>
  )
}
