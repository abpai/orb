import { useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'

import type { SessionSummary } from '../../services/session'

interface SessionPickerProps {
  sessions: SessionSummary[]
  currentProjectPath?: string
  currentId?: string
  onSelect: (session: SessionSummary) => void
  onCancel: () => void
}

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

function matchesFilter(session: SessionSummary, filter: string): boolean {
  if (!filter) return true
  const haystack = `${session.projectName} ${session.preview} ${session.llmModel}`.toLowerCase()
  return haystack.includes(filter.toLowerCase())
}

export function SessionPicker({
  sessions,
  currentProjectPath,
  currentId,
  onSelect,
  onCancel,
}: SessionPickerProps) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(0)

  const visible = useMemo(
    () => sessions.filter((s) => matchesFilter(s, filter)),
    [sessions, filter],
  )
  const clampedSelected = Math.min(selected, Math.max(visible.length - 1, 0))

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
    if (key.tab || key.return) return
    // Printable characters filter the list live. Fast typing / paste can arrive
    // as a multi-char chunk, so keep every printable character in the input.
    if (input && !key.ctrl && !key.meta) {
      const printable = [...input].filter((char) => char >= ' ' && char !== '').join('')
      if (printable.length > 0) {
        setFilter((prev) => prev + printable)
        setSelected(0)
      }
    }
  })

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color="cyan">Resume a session</Text>
      <Text color="gray" dimColor>
        {filter ? `filter: ${filter}` : '↑↓ navigate · type to filter · enter resume · esc cancel'}
      </Text>
      <Text> </Text>
      {visible.length === 0 ? (
        <Text color="gray" dimColor>
          {sessions.length === 0 ? 'No saved sessions yet.' : 'No sessions match your filter.'}
        </Text>
      ) : (
        visible.map((session, idx) => {
          const isSelected = idx === clampedSelected
          const isCurrent =
            session.id === currentId &&
            currentProjectPath !== undefined &&
            session.projectPath === currentProjectPath
          const preview = session.preview || '(no messages yet)'
          return (
            <Box key={`${session.projectPath}:${session.id}`}>
              <Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '› ' : '  '}</Text>
              <Box flexDirection="column">
                <Text color={isSelected ? 'cyan' : undefined}>
                  {session.projectName}
                  <Text color="gray" dimColor>
                    {`  ${formatProviderLabel(session.llmProvider)} · ${formatRelativeTime(
                      session.lastModified,
                    )} · ${session.turnCount} turns`}
                    {isCurrent ? ' · current' : ''}
                  </Text>
                </Text>
                <Text color="gray" dimColor>
                  {truncate(preview, 72)}
                </Text>
              </Box>
            </Box>
          )
        })
      )}
    </Box>
  )
}

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}
