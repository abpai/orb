import React from 'react'
import { Box, Text } from 'ink'
import type { ToolCall } from '../../types'
import { MessageBox } from './shared/MessageBox'
import { ToolTree } from './shared/ToolTree'
import { stripMarkdown } from '../utils/markdown'

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
      <MessageBox role="you" content={entry.question} />

      {entry.toolCalls.length > 0 && <ToolTree calls={entry.toolCalls} />}

      {(entry.answer || entry.error) && (
        <MessageBox
          role="claude"
          content={entry.answer ? stripMarkdown(entry.answer) : `Error: ${entry.error}`}
          isError={!!entry.error}
        />
      )}
    </Box>
  )
})

export const ConversationPanel = React.memo(function ConversationPanel({
  entries,
  maxEntries = 50,
}: ConversationPanelProps) {
  if (entries.length === 0) return null

  const displayEntries = maxEntries > 0 ? entries.slice(-maxEntries) : entries
  const truncated = maxEntries > 0 && entries.length > maxEntries

  return (
    <Box flexDirection="column" marginY={1}>
      {truncated && (
        <Text color="gray" dimColor>
          ... ({entries.length - maxEntries} earlier messages)
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
