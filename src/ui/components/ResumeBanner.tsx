import React from 'react'
import { Box, Text } from 'ink'

import type { ResumeInfo } from '../../types'

interface ResumeBannerProps {
  info: ResumeInfo
}

function sourceLabel(source: ResumeInfo['source']): string {
  return source === 'claude' ? 'Claude Code' : 'Codex'
}

function pluralizeMessages(count: number): string {
  return `${count} earlier message${count === 1 ? '' : 's'}`
}

/**
 * Shown when an external session is resumed with empty scrollback. It reassures
 * the user that prior history is hidden from view but the model still has it,
 * including a message count when one could be looked up.
 */
export function ResumeBanner({ info }: ResumeBannerProps): React.ReactNode {
  const label = sourceLabel(info.source)
  const detail =
    info.messageCount && info.messageCount > 0
      ? `${pluralizeMessages(info.messageCount)} hidden · the model still has full context`
      : 'earlier history hidden · the model still remembers it'

  return (
    <Box marginBottom={1}>
      <Text color="cyan">
        ↩ Resumed {label} session · <Text dimColor>{detail}</Text>
      </Text>
    </Box>
  )
}
