import { memo } from 'react'
import { Box, Text } from 'ink'

import type { AppState, LlmModelId, LlmProvider } from '../../types'
import { useTerminalSize } from '../hooks/useTerminalSize'
import { formatModelLabel } from '../utils/model-label'
import { InputPrompt } from './InputPrompt'
import { MicroOrb } from './MicroOrb'

interface FooterProps {
  state: AppState
  onSubmit: (value: string) => void
  inputDisabled: boolean
  model: LlmModelId
  provider: LlmProvider
  canCycleModel: boolean
}

export const Footer = memo(function Footer({
  state,
  onSubmit,
  inputDisabled,
  model,
  provider,
  canCycleModel,
}: FooterProps) {
  const { columns } = useTerminalSize()
  const modelLabel = formatModelLabel(provider, model)

  const showModel = columns >= 60
  const showAllHints = columns >= 80
  const isStreaming = state !== 'idle'

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box gap={1}>
        <MicroOrb state={state} />
        <InputPrompt onSubmit={onSubmit} disabled={inputDisabled} streaming={isStreaming} inline />
      </Box>
      <Box gap={2}>
        {showModel && (
          <Text color="gray" dimColor>
            [{modelLabel}]
          </Text>
        )}
        {showAllHints && canCycleModel && (
          <Text color="gray" dimColor>
            ⇧Tab model
          </Text>
        )}
        {showAllHints && (
          <Text color="gray" dimColor>
            ^O detail
          </Text>
        )}
        <Text color="gray" dimColor>
          ^C
        </Text>
      </Box>
    </Box>
  )
})
