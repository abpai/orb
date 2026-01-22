import React from 'react'
import { Box, Text, useInput } from 'ink'
import type { HistoryEntry } from './ConversationPanel'
import { MessageBox } from './shared/MessageBox'
import { ToolTree } from './shared/ToolTree'
import { stripMarkdown } from '../utils/markdown'

interface TranscriptViewerProps {
  entries: HistoryEntry[]
  onClose: () => void
}

interface EntryDisplayProps {
  entry: HistoryEntry
  index: number
}

const EntryDisplay = React.memo(function EntryDisplay({ entry, index }: EntryDisplayProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="gray" dimColor>
          [{index + 1}]
        </Text>
      </Box>
      <Box paddingLeft={2} flexDirection="column">
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
    </Box>
  )
})

export function TranscriptViewer({ entries, onClose }: TranscriptViewerProps) {
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'o')) {
      onClose()
    }
  })

  if (entries.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="cyan" bold>
          ─ Transcript ─
        </Text>
        <Text color="gray" dimColor>
          No messages yet. Press Ctrl+O or Esc to close.
        </Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          ─ Transcript ({entries.length} messages) ─
        </Text>
        <Text color="gray"> Ctrl+O or Esc to close</Text>
      </Box>
      <Text color="gray" dimColor>
        Use your terminal scrollback to view the full transcript.
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {entries.map((entry, i) => (
          <EntryDisplay key={entry.id} entry={entry} index={i} />
        ))}
      </Box>
    </Box>
  )
}
