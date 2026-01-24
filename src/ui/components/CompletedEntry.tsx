import React from 'react'
import { Box } from 'ink'

import type { HistoryEntry } from './ConversationPanel'
import { EntryContent } from './shared/EntryContent'

interface CompletedEntryProps {
  entry: HistoryEntry
}

export function CompletedEntry({ entry }: CompletedEntryProps) {
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
}
