import { memo } from 'react'
import { Box, Text } from 'ink'

import type { AppState, LlmModelId, LlmProvider } from '../../types'
import { useTerminalSize } from '../hooks/useTerminalSize'
import { formatModelLabel } from '../utils/model-label'
import { InputPrompt } from './InputPrompt'

interface FooterProps {
  state: AppState
  onSubmit: (value: string) => void
  onEdit?: () => void
  model: LlmModelId
  provider: LlmProvider
  modelLabels?: Record<LlmModelId, string>
  canCycleModel: boolean
  canOpenFiles?: boolean
  canTogglePause: boolean
  canRepeat: boolean
  isPaused: boolean
  projectPath?: string
  yolo?: boolean
  onMenuOpenChange?: (open: boolean) => void
}

export const Footer = memo(function Footer({
  state,
  onSubmit,
  onEdit,
  model,
  provider,
  modelLabels,
  canCycleModel,
  canOpenFiles,
  canTogglePause,
  canRepeat,
  isPaused,
  projectPath,
  yolo,
  onMenuOpenChange,
}: FooterProps) {
  const { columns } = useTerminalSize()
  const modelLabel = formatModelLabel(provider, model, modelLabels)

  const showModel = columns >= 60
  const showAllHints = columns >= 80

  return (
    <Box flexDirection="column">
      <InputPrompt
        onSubmit={onSubmit}
        onEdit={onEdit}
        state={state}
        projectPath={projectPath}
        onMenuOpenChange={onMenuOpenChange}
      />
      <Box gap={2}>
        {showModel && (
          <Text color="gray" dimColor>
            [{modelLabel}]
          </Text>
        )}
        {yolo && <Text color="red">YOLO</Text>}
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
        {showAllHints && canOpenFiles && (
          <Text color="gray" dimColor>
            ^G open
          </Text>
        )}
        <Text color="gray" dimColor>
          ^C
        </Text>
      </Box>
    </Box>
  )
})
