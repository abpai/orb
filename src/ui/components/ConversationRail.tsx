import { memo, useMemo } from 'react'
import { Box, Static, Text } from 'ink'

import type { DetailMode, HistoryEntry } from '../../types'
import { TurnRow } from './TurnRow'

interface ConversationRailProps {
  completedTurns: HistoryEntry[]
  /** Resumed turns omitted from rendering (still in model context); shown as a hint. */
  hiddenTurnCount?: number
  liveTurn: HistoryEntry | null
  detailMode: DetailMode
  maxAnswerLines?: number
  assistantLabel: string
}

// Ink renders <Static> output above the interactive frame regardless of JSX
// order, so the "older turns hidden" hint can't be a plain sibling — it would
// land at the bottom near the footer. Flush it as the first static item so it
// sits above the restored turns it describes.
type RailItem = { kind: 'hint'; count: number } | { kind: 'turn'; turn: HistoryEntry }

export const ConversationRail = memo(function ConversationRail({
  completedTurns,
  hiddenTurnCount = 0,
  liveTurn,
  detailMode,
  maxAnswerLines,
  assistantLabel,
}: ConversationRailProps) {
  const items = useMemo<RailItem[]>(() => {
    const turns = completedTurns.map((turn): RailItem => ({ kind: 'turn', turn }))
    return hiddenTurnCount > 0 ? [{ kind: 'hint', count: hiddenTurnCount }, ...turns] : turns
  }, [completedTurns, hiddenTurnCount])

  return (
    <Box flexDirection="column">
      <Static items={items}>
        {(item, index) =>
          item.kind === 'hint' ? (
            <Text key="hidden-hint" dimColor>
              {`⋮ ${item.count} earlier turn${item.count === 1 ? '' : 's'} hidden (still in context)`}
            </Text>
          ) : (
            <Box key={item.turn.id ?? index} marginBottom={1}>
              <TurnRow turn={item.turn} detailMode="compact" assistantLabel={assistantLabel} />
            </Box>
          )
        }
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
