import React, { memo, useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'

interface InputPromptProps {
  onSubmit: (value: string) => void
  disabled: boolean
  inline?: boolean
}

function Cursor({ visible }: { visible: boolean }): React.ReactNode {
  if (!visible) return null
  return <Text backgroundColor="white"> </Text>
}

export const InputPrompt = memo(function InputPrompt({
  onSubmit,
  disabled,
  inline = false,
}: InputPromptProps): React.ReactNode {
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

      if (key.tab || input === '\u001b[Z') {
        return
      }

      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1))
        return
      }

      // Ctrl+W - delete previous word
      if (key.ctrl && input === 'w') {
        setValue((v) => v.replace(/\S+\s*$/, ''))
        return
      }

      // Ctrl+U - delete entire line
      if (key.ctrl && input === 'u') {
        setValue('')
        return
      }

      if (input && !key.ctrl && !key.meta) {
        setValue((v) => v + input)
      }
    },
    { isActive: !disabled },
  )

  const promptColor = disabled ? 'gray' : 'cyan'

  const content = disabled ? (
    <>
      <Text color={promptColor}>❯ </Text>
      <Text color="gray">{value || '...'}</Text>
    </>
  ) : (
    <>
      <Text color={promptColor}>❯ </Text>
      <Text>
        {value}
        <Cursor visible={cursorVisible} />
      </Text>
    </>
  )

  if (inline) return content

  return <Box marginTop={1}>{content}</Box>
})
