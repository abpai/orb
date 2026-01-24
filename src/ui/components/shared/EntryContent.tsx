import React, { useMemo } from 'react'
import { Box, Text } from 'ink'

import type { ToolCall } from '../../../types'
import { stripMarkdown } from '../../utils/markdown'
import { truncateLines } from '../../utils/text'
import { MessageBox } from './MessageBox'
import { ToolTree } from './ToolTree'

export interface EntryContentProps {
  question: string
  toolCalls: ToolCall[]
  answer: string
  error?: string | null
  maxAnswerLines?: number
}

export const EntryContent = React.memo(function EntryContent({
  question,
  toolCalls,
  answer,
  error,
  maxAnswerLines,
}: EntryContentProps) {
  const hasResponse = answer || error
  const rawContent = answer ? stripMarkdown(answer) : `Error: ${error}`

  const { displayContent, truncatedCount } = useMemo(() => {
    if (!maxAnswerLines || !answer) {
      return { displayContent: rawContent, truncatedCount: 0 }
    }
    const result = truncateLines(rawContent, maxAnswerLines)
    return { displayContent: result.text, truncatedCount: result.truncatedCount }
  }, [rawContent, maxAnswerLines, answer])

  return (
    <>
      <MessageBox role="you" content={question} />

      {toolCalls.length > 0 && <ToolTree calls={toolCalls} />}

      {truncatedCount > 0 && (
        <Box marginBottom={0}>
          <Text dimColor>{`\u22ee (${truncatedCount} lines above, ^O for full)`}</Text>
        </Box>
      )}

      {hasResponse && <MessageBox role="claude" content={displayContent} isError={!!error} />}
    </>
  )
})
