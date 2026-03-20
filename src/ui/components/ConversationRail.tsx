import { memo } from 'react'
import { Box, Static } from 'ink'

import type { DetailMode, HistoryEntry } from '../../types'
import { TurnRow } from './TurnRow'

interface ConversationRailProps {
  completedTurns: HistoryEntry[]
  liveTurn: HistoryEntry | null
  detailMode: DetailMode
  maxAnswerLines?: number
  assistantLabel: string
}

export const ConversationRail = memo(function ConversationRail({
  completedTurns,
  liveTurn,
  detailMode,
  maxAnswerLines,
  assistantLabel,
}: ConversationRailProps) {
  return (
    <Box flexDirection="column">
      <Static items={completedTurns}>
        {(turn) => (
          <Box key={turn.id} marginBottom={1}>
            <TurnRow turn={turn} detailMode="compact" assistantLabel={assistantLabel} />
          </Box>
        )}
      </Static>
      {liveTurn && (
        <Box marginBottom={1}>
          <TurnRow
            turn={liveTurn}
            detailMode={detailMode}
            isLive
            maxAnswerLines={maxAnswerLines}
            assistantLabel={assistantLabel}
          />
        </Box>
      )}
    </Box>
  )
})
