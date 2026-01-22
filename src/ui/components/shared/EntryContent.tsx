import React from 'react'

import type { ToolCall } from '../../../types'
import { stripMarkdown } from '../../utils/markdown'
import { MessageBox } from './MessageBox'
import { ToolTree } from './ToolTree'

export interface EntryContentProps {
  question: string
  toolCalls: ToolCall[]
  answer: string
  error?: string | null
}

export const EntryContent = React.memo(function EntryContent({
  question,
  toolCalls,
  answer,
  error,
}: EntryContentProps) {
  const hasResponse = answer || error
  const responseContent = answer ? stripMarkdown(answer) : `Error: ${error}`

  return (
    <>
      <MessageBox role="you" content={question} />

      {toolCalls.length > 0 && <ToolTree calls={toolCalls} />}

      {hasResponse && <MessageBox role="claude" content={responseContent} isError={!!error} />}
    </>
  )
})
