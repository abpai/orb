import { memo } from 'react'
import { Box, Text } from 'ink'

import type { AppState, LlmModelId, LlmProvider } from '../../types'
import { useTerminalSize } from '../hooks/useTerminalSize'
import { formatModelLabel } from '../utils/model-label'
import { InputPrompt } from './InputPrompt'

interface FooterProps {
  state: AppState
  onSubmit: (value: string) => void
  model: LlmModelId
  provider: LlmProvider
  canCycleModel: boolean
  canTogglePause: boolean
  canRepeat: boolean
  isPaused: boolean
  projectPath?: string
}

export const Footer = memo(function Footer({
  state,
  onSubmit,
  model,
  provider,
  canCycleModel,
  canTogglePause,
  canRepeat,
  isPaused,
  projectPath,
}: FooterProps) {
  const { columns } = useTerminalSize()
  const modelLabel = formatModelLabel(provider, model)

  const showModel = columns >= 60
  const showAllHints = columns >= 80

  return (
    <Box flexDirection="column">
      <InputPrompt onSubmit={onSubmit} state={state} projectPath={projectPath} />
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
        {canTogglePause && (
          <Text color="gray" dimColor>
            {isPaused ? '^P resume' : '^P pause'}
          </Text>
        )}
        {showAllHints && canRepeat && (
          <Text color="gray" dimColor>
            ^R repeat
          </Text>
        )}
        <Text color="gray" dimColor>
          ^C
        </Text>
      </Box>
    </Box>
  )
})
