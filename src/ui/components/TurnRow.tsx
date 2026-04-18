import { memo, useMemo } from 'react'
import { Box, Text } from 'ink'

import type { DetailMode, HistoryEntry } from '../../types'
import { stripMarkdown } from '../utils/markdown'
import { truncateLines } from '../utils/text'
import { ActivityTimeline } from './ActivityTimeline'

interface TurnRowProps {
  turn: HistoryEntry
  detailMode: DetailMode
  isLive?: boolean
  maxAnswerLines?: number
  assistantLabel: string
}

export const TurnRow = memo(function TurnRow({
  turn,
  detailMode,
  isLive = false,
  maxAnswerLines,
  assistantLabel,
}: TurnRowProps) {
  const hasAnswer = Boolean(turn.answer || turn.error)

  // While the turn is live, skip stripMarkdown — it runs on the full
  // accumulated answer on every token delta, which dominates typing-time work
  // during streaming. The completed turn still gets the cleanup pass.
  const { displayContent, truncatedCount } = useMemo(() => {
    if (!turn.answer && !turn.error) return { displayContent: '', truncatedCount: 0 }

    const rawContent = turn.answer
      ? isLive
        ? turn.answer
        : stripMarkdown(turn.answer)
      : `Error: ${turn.error}`
    if (!maxAnswerLines || !turn.answer) {
      return { displayContent: rawContent, truncatedCount: 0 }
    }
    const result = truncateLines(rawContent, maxAnswerLines)
    return { displayContent: result.text, truncatedCount: result.truncatedCount }
  }, [turn.answer, turn.error, maxAnswerLines, isLive])

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="cyan" bold>
          you:{' '}
        </Text>
        <Text wrap="wrap">{turn.question}</Text>
      </Text>

      {turn.toolCalls.length > 0 && (
        <ActivityTimeline toolCalls={turn.toolCalls} detailMode={detailMode} isLive={isLive} />
      )}

      {truncatedCount > 0 && <Text dimColor>{`⋮ (${truncatedCount} lines above)`}</Text>}

      {isLive && !hasAnswer ? (
        <Text>
          <Text color="green" bold>
            {assistantLabel}:{' '}
          </Text>
          <Text dimColor>…</Text>
        </Text>
      ) : hasAnswer ? (
        <Text>
          <Text color="green" bold>
            {assistantLabel}:{' '}
          </Text>
          <Text wrap="wrap" color={turn.error ? 'red' : undefined}>
            {displayContent}
          </Text>
        </Text>
      ) : null}
    </Box>
  )
})
