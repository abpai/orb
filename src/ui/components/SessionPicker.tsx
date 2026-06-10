import { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'

import type { SessionSummary } from '../../services/session'
import type { SessionSource } from '../../types'
import { abbreviateHome } from '../../services/orb-paths'
import { useTerminalSize } from '../hooks/useTerminalSize'
import { collapseToSingleLine } from '../utils/text'

interface SessionPickerProps {
  sessions: SessionSummary[]
  currentProjectPath?: string
  currentId?: string
  onSelect: (session: SessionSummary) => void
  onCancel: () => void
  /** Optional advisory line under the hint (e.g. a capped-scan notice). */
  note?: string
}

/** Lines of chrome above/below the scrolling list (title, hint, blank, indicators, padding). */
const VIEWPORT_OVERHEAD = 9
const LINES_PER_ROW = 2
const MIN_VISIBLE_ROWS = 3

export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'unknown'
  const diffSec = Math.max(0, Math.round((now - then) / 1000))
  if (diffSec < 45) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hr ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay === 1) return 'yesterday'
  if (diffDay < 30) return `${diffDay} days ago`
  const diffMonth = Math.round(diffDay / 30)
  return diffMonth < 12 ? `${diffMonth} mo ago` : `${Math.round(diffMonth / 12)} yr ago`
}

export function formatProviderLabel(provider: SessionSummary['llmProvider']): string {
  if (provider === 'anthropic') return 'claude'
  return provider
}

export function pluralizeTurns(count: number): string {
  return `${count} turn${count === 1 ? '' : 's'}`
}

export function formatSourceTag(source?: SessionSource): string {
  if (source === 'claude') return 'claude code'
  if (source === 'codex') return 'codex'
  return 'orb'
}

function sessionTitle(session: SessionSummary): string {
  return session.preview.trim() || '(no messages yet)'
}

function matchesFilter(session: SessionSummary, filter: string): boolean {
  if (!filter) return true
  // External rows carry no recorded model, so only orb rows contribute one.
  const model = session.source === 'orb' ? session.llmModel : ''
  const haystack =
    `${formatSourceTag(session.source)} ${session.projectName} ${session.projectPath} ${session.preview} ${model}`.toLowerCase()
  return haystack.includes(filter.toLowerCase())
}

export function SessionPicker({
  sessions,
  currentProjectPath,
  currentId,
  onSelect,
  onCancel,
  note,
}: SessionPickerProps) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(0)
  const [windowStart, setWindowStart] = useState(0)
  const { rows } = useTerminalSize()

  const visible = useMemo(
    () => sessions.filter((s) => matchesFilter(s, filter)),
    [sessions, filter],
  )
  const clampedSelected = Math.min(selected, Math.max(visible.length - 1, 0))

  // How many rows fit in the current terminal, leaving room for the chrome.
  const windowSize = Math.max(
    MIN_VISIBLE_ROWS,
    Math.floor((rows - VIEWPORT_OVERHEAD) / LINES_PER_ROW),
  )

  // Scroll the window only when the selection reaches an edge, keeping it in view.
  useEffect(() => {
    setWindowStart((start) => {
      const maxStart = Math.max(0, visible.length - windowSize)
      let next = Math.min(start, maxStart)
      if (clampedSelected < next) next = clampedSelected
      else if (clampedSelected >= next + windowSize) next = clampedSelected - windowSize + 1
      return Math.max(0, next)
    })
  }, [clampedSelected, windowSize, visible.length])

  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (key.upArrow) {
      setSelected((prev) => Math.max(prev - 1, 0))
      return
    }
    if (key.downArrow) {
      setSelected((prev) => Math.min(prev + 1, Math.max(visible.length - 1, 0)))
      return
    }
    if (key.return) {
      const chosen = visible[clampedSelected]
      if (chosen) onSelect(chosen)
      return
    }
    if (key.backspace || key.delete) {
      setFilter((prev) => prev.slice(0, -1))
      setSelected(0)
      return
    }
    if (key.tab) return
    // Printable characters filter the list live. Fast typing / paste can arrive
    // as a multi-char chunk, so keep every printable character in the input.
    if (input && !key.ctrl && !key.meta) {
      // Keep printable characters only: drop C0 control bytes (< space) and the
      // raw DEL byte (0x7f) some terminals send for Backspace without setting key.delete.
      const printable = [...input].filter((char) => char >= ' ' && char !== '\x7f').join('')
      if (printable.length > 0) {
        setFilter((prev) => prev + printable)
        setSelected(0)
      }
    }
  })

  const windowEnd = Math.min(visible.length, windowStart + windowSize)
  const windowed = visible.slice(windowStart, windowEnd)
  const hiddenAbove = windowStart
  const hiddenBelow = visible.length - windowEnd

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan">Resume a session</Text>
      <Text color="gray" dimColor>
        {filter ? `filter: ${filter}` : '↑↓ navigate · type to filter · enter resume · esc cancel'}
      </Text>
      {note ? (
        <Text color="yellow" dimColor>
          {note}
        </Text>
      ) : null}
      <Text> </Text>
      {visible.length === 0 ? (
        <Text color="gray" dimColor>
          {sessions.length === 0 ? 'No saved sessions yet.' : 'No sessions match your filter.'}
        </Text>
      ) : (
        <>
          <Text color="gray" dimColor>
            {hiddenAbove > 0 ? `  ↑ ${hiddenAbove} more` : ' '}
          </Text>
          {windowed.map((session, idx) => {
            const isSelected = windowStart + idx === clampedSelected
            const isCurrent =
              session.id === currentId &&
              currentProjectPath !== undefined &&
              session.projectPath === currentProjectPath
            const meta = `${formatSourceTag(session.source)} · ${abbreviateHome(
              session.projectPath,
            )} · ${formatProviderLabel(session.llmProvider)} · ${formatRelativeTime(
              session.lastModified,
            )} · ${pluralizeTurns(session.turnCount)}`
            return (
              <Box key={`${session.projectPath}:${session.id}`}>
                <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '› ' : '  '}</Text>
                <Box flexDirection="column">
                  <Text color={isSelected ? 'cyan' : undefined} bold={isSelected} wrap="truncate">
                    {collapseToSingleLine(sessionTitle(session), 72)}
                  </Text>
                  <Text color="gray" dimColor wrap="truncate">
                    {meta}
                    {isCurrent ? ' · current' : ''}
                  </Text>
                </Box>
              </Box>
            )
          })}
          <Text color="gray" dimColor>
            {hiddenBelow > 0 ? `  ↓ ${hiddenBelow} more` : ' '}
          </Text>
        </>
      )}
    </Box>
  )
}
