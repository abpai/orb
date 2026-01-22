import React from 'react'
import { Box } from 'ink'
import type { HistoryEntry } from './ConversationPanel'
import { MessageBox } from './shared/MessageBox'
import { ToolTree } from './shared/ToolTree'
import { stripMarkdown } from '../utils/markdown'

interface ActiveMessagePanelProps {
  entry: HistoryEntry | null
}

export const ActiveMessagePanel = React.memo(function ActiveMessagePanel({
  entry,
}: ActiveMessagePanelProps) {
  if (!entry) return null

  return (
    <Box flexDirection="column" marginY={1}>
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
