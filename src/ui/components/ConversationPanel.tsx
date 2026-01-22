import React from 'react'
import { Box, Text } from 'ink'

import type { ToolCall } from '../../types'
import { EntryContent } from './shared/EntryContent'

export interface HistoryEntry {
  id: string
  question: string
  toolCalls: ToolCall[]
  answer: string
  error?: string | null
}

interface ConversationPanelProps {
  entries: HistoryEntry[]
  maxEntries?: number
}

interface ConversationEntryProps {
  entry: HistoryEntry
  isLast: boolean
}

const ConversationEntry = React.memo(function ConversationEntry({
  entry,
  isLast,
}: ConversationEntryProps) {
  return (
    <Box flexDirection="column" marginBottom={isLast ? 0 : 1}>
      <EntryContent
        question={entry.question}
        toolCalls={entry.toolCalls}
        answer={entry.answer}
        error={entry.error}
      />
    </Box>
  )
})

export const ConversationPanel = React.memo(function ConversationPanel({
  entries,
  maxEntries = 50,
}: ConversationPanelProps) {
  if (entries.length === 0) return null

  const shouldTruncate = maxEntries > 0 && entries.length > maxEntries
  const displayEntries = shouldTruncate ? entries.slice(-maxEntries) : entries
  const hiddenCount = entries.length - displayEntries.length

  return (
    <Box flexDirection="column" marginY={1}>
      {hiddenCount > 0 && (
        <Text color="gray" dimColor>
          ... ({hiddenCount} earlier messages)
        </Text>
      )}
      <Box flexDirection="column">
        {displayEntries.map((entry, i) => (
          <ConversationEntry
            key={entry.id}
            entry={entry}
            isLast={i === displayEntries.length - 1}
          />
        ))}
      </Box>
    </Box>
  )
})
