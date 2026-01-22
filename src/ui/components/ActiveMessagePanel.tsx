import React from 'react'
import { Box } from 'ink'

import type { HistoryEntry } from './ConversationPanel'
import { EntryContent } from './shared/EntryContent'

interface ActiveMessagePanelProps {
  entry: HistoryEntry | null
}

export const ActiveMessagePanel = React.memo(function ActiveMessagePanel({
  entry,
}: ActiveMessagePanelProps) {
  if (!entry) return null

  return (
    <Box flexDirection="column" marginY={1}>
      <EntryContent
        question={entry.question}
        toolCalls={entry.toolCalls}
        answer={entry.answer}
        error={entry.error}
      />
    </Box>
  )
})
