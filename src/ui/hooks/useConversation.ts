import { useCallback, useEffect, useRef, useState } from 'react'
import { randomUUID } from 'node:crypto'

import type { OutboundFrame } from '../../pipeline/transports/types'
import type { RunResult } from '../../pipeline/task'
import { modelAliasFamily } from '../../services/model-catalog'
import { saveSession } from '../../services/session'
import { warn } from '../../services/log'
import {
  type AgentSession,
  type AppConfig,
  type AppState,
  type HistoryEntry,
  type LlmModelId,
  type SavedSession,
  type TTSErrorType,
} from '../../types'
import { getModelChoices } from '../utils/model-choices'
import { useSyncedRef } from './useSyncedRef'
import { useTimerSlot } from './useTimerSlot'

export { getModelChoices }

interface UseConversationConfig {
  config: AppConfig
  initialSession?: SavedSession | null
  /** Stable id for this conversation; minted here when starting fresh. */
  orbSessionId?: string
  taskState: AppState
  /** Throttle window for live-delta renders; injectable so tests can shrink it. */
  renderIntervalMs?: number
}

function shouldRestoreSessionModel(config: AppConfig, model?: LlmModelId): model is LlmModelId {
  if (!model) return false

  const modelChoices = getModelChoices(config)
  if (modelChoices.includes(model)) return true

  const family = modelAliasFamily(config.llmProvider, model)
  if (!family) return true

  return !modelChoices.some((choice) => modelAliasFamily(config.llmProvider, choice) === family)
}

function createLocalEntry(
  question: string,
  options: { answer?: string; error?: string | null } = {},
): HistoryEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    question,
    toolCalls: [],
    answer: options.answer ?? '',
    error: options.error ?? null,
  }
}

const LIVE_DELTA_RENDER_INTERVAL_MS = 50

export function useConversation({
  config,
  initialSession,
  orbSessionId,
  taskState,
  renderIntervalMs = LIVE_DELTA_RENDER_INTERVAL_MS,
}: UseConversationConfig) {
  const sessionMatchesProvider = initialSession?.llmProvider === config.llmProvider
  const initialHistory = sessionMatchesProvider ? (initialSession?.history ?? []) : []
  const sessionModel = sessionMatchesProvider ? initialSession?.llmModel : undefined
  const initialModel = shouldRestoreSessionModel(config, sessionModel)
    ? sessionModel
    : config.llmModel
  const initialAgentSession = sessionMatchesProvider ? initialSession?.agentSession : undefined

  const [completedTurns, setCompletedTurns] = useState<HistoryEntry[]>(initialHistory)
  // liveTurnRef is read synchronously inside frame/run handlers (archive guards,
  // coalesce decisions) before React re-renders; updateLiveTurn keeps it in lockstep.
  const [liveTurn, liveTurnRef, updateLiveTurn] = useSyncedRef<HistoryEntry | null>(null)
  const [ttsError, setTtsError] = useState<{ type: TTSErrorType; message: string } | null>(null)
  const [activeModel, setActiveModel] = useState<LlmModelId>(initialModel)

  const activeEntryIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string>(orbSessionId ?? initialSession?.id ?? randomUUID())
  const agentSessionRef = useRef<AgentSession | undefined>(initialAgentSession)
  const pendingSaveRef = useRef(false)
  const pendingRenderTurnRef = useRef<HistoryEntry | null>(null)
  const renderFlushPendingRef = useRef(false)
  const lastRenderFlushAtRef = useRef(0)

  const renderFlushTimer = useTimerSlot()

  const clearScheduledRenderFlush = useCallback(() => {
    renderFlushPendingRef.current = false
    renderFlushTimer.clear()
  }, [renderFlushTimer])

  const flushPendingLiveTurn = useCallback(() => {
    renderFlushPendingRef.current = false
    lastRenderFlushAtRef.current = Date.now()
    const pending = pendingRenderTurnRef.current
    pendingRenderTurnRef.current = null
    if (pending && liveTurnRef.current !== null) {
      // Bypass updateLiveTurn: the ref already holds `pending`; only state lags.
      updateLiveTurn(pending)
    }
  }, [liveTurnRef, updateLiveTurn])

  /**
   * Keep the ref updated for every token, but cap React/Ink rendering to a
   * human-visible frame budget. A one-tick coalesce still lets fast providers
   * reconcile the whole terminal almost continuously, which crowds out typing.
   */
  const scheduleRenderFlush = useCallback(() => {
    if (renderFlushPendingRef.current) return
    const elapsed = Date.now() - lastRenderFlushAtRef.current
    const delay = Math.max(0, renderIntervalMs - elapsed)
    renderFlushPendingRef.current = true
    renderFlushTimer.schedule(flushPendingLiveTurn, delay)
  }, [flushPendingLiveTurn, renderFlushTimer, renderIntervalMs])

  const getHistorySnapshot = useCallback(
    () => [...completedTurns, ...(liveTurnRef.current ? [liveTurnRef.current] : [])],
    [completedTurns],
  )

  const persistSession = useCallback(
    async (modelOverride?: LlmModelId, historyOverride?: HistoryEntry[]) => {
      const history = historyOverride ?? getHistorySnapshot()
      const payload: SavedSession = {
        version: 2,
        id: sessionIdRef.current,
        projectPath: config.projectPath,
        llmProvider: config.llmProvider,
        llmModel: modelOverride ?? activeModel,
        agentSession: agentSessionRef.current,
        lastModified: new Date().toISOString(),
        history,
      }

      try {
        await saveSession(payload)
      } catch (err) {
        warn('Failed to save session:', err)
      }
    },
    [activeModel, config.llmProvider, config.projectPath, getHistorySnapshot],
  )

  useEffect(() => {
    if (!pendingSaveRef.current) return
    if (taskState !== 'idle') return
    pendingSaveRef.current = false
    void persistSession()
  }, [completedTurns, persistSession, taskState])

  const startEntry = useCallback(
    (query: string) => {
      const trimmed = query.trim()
      if (!trimmed) return null

      // Archive any existing live turn (safety net for edge cases)
      const existingLiveTurn = liveTurnRef.current
      if (existingLiveTurn !== null) {
        liveTurnRef.current = null
        pendingRenderTurnRef.current = null
        setCompletedTurns((prev) => [...prev, existingLiveTurn])
      }

      const newTurn = createLocalEntry(trimmed)
      const entryId = newTurn.id

      activeEntryIdRef.current = entryId
      pendingRenderTurnRef.current = null
      clearScheduledRenderFlush()
      updateLiveTurn(newTurn)
      setTtsError(null)

      return { entryId, query: trimmed }
    },
    [clearScheduledRenderFlush, updateLiveTurn],
  )

  const handleFrame = useCallback(
    (frame: OutboundFrame) => {
      // tts-error is global state — it can fire outside a live turn (e.g. repeatTts
      // runs while idle), so handle it before the live-turn guard.
      if (frame.kind === 'tts-error') {
        setTtsError({ type: frame.errorType, message: frame.message })
        return
      }

      if (!liveTurnRef.current) return
      const cur = liveTurnRef.current

      // Any non-delta frame supersedes a coalesced delta; only agent-text-delta
      // re-arms the pending ref below.
      if (frame.kind !== 'agent-text-delta') {
        pendingRenderTurnRef.current = null
        clearScheduledRenderFlush()
      }

      switch (frame.kind) {
        case 'agent-text-delta': {
          const next = { ...cur, answer: frame.accumulatedText }
          liveTurnRef.current = next
          pendingRenderTurnRef.current = next
          scheduleRenderFlush()
          break
        }

        case 'agent-text-complete':
          updateLiveTurn({ ...cur, answer: frame.text })
          break

        case 'tool-call-start':
          updateLiveTurn({ ...cur, toolCalls: [...cur.toolCalls, frame.toolCall] })
          break

        case 'tool-call-result':
          updateLiveTurn({
            ...cur,
            toolCalls: cur.toolCalls.map((tc) =>
              tc.id === frame.toolId ? { ...tc, status: frame.status, result: frame.result } : tc,
            ),
          })
          break

        case 'agent-error':
          updateLiveTurn({ ...cur, error: frame.error.message })
          break
      }
    },
    [clearScheduledRenderFlush, scheduleRenderFlush, updateLiveTurn],
  )

  const handleRunComplete = useCallback(
    (result: RunResult) => {
      // Guard: only archive the turn this run belongs to.
      // If startEntry already replaced it with a new turn, skip.
      if (liveTurnRef.current === null) return
      if (activeEntryIdRef.current !== result.entryId) return

      if (result.session) {
        agentSessionRef.current = result.session
      }

      const turnToArchive = liveTurnRef.current
      activeEntryIdRef.current = null
      pendingRenderTurnRef.current = null
      clearScheduledRenderFlush()
      setCompletedTurns((prev) => [...prev, turnToArchive])
      updateLiveTurn(null)

      if (!result.cancelled) {
        pendingSaveRef.current = true
      }
    },
    [clearScheduledRenderFlush, updateLiveTurn],
  )

  const cycleModel = useCallback(() => {
    const modelChoices = getModelChoices(config)
    if (modelChoices.length < 2) return

    const currentIndex = modelChoices.indexOf(activeModel)
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modelChoices.length
    const nextModel = modelChoices[nextIndex] ?? modelChoices[0]
    if (!nextModel) return
    setActiveModel(nextModel)

    void persistSession(nextModel)
  }, [activeModel, config.llmModelChoices, config.llmProvider, persistSession])

  const recordLocalError = useCallback((question: string, message: string) => {
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion || !message.trim()) return

    const entry = createLocalEntry(trimmedQuestion, { error: message })

    setCompletedTurns((prev) => [...prev, entry])
    pendingSaveRef.current = true
  }, [])

  const recordLocalAnswer = useCallback((question: string, answer: string) => {
    const trimmedQuestion = question.trim()
    const trimmedAnswer = answer.trim()
    if (!trimmedQuestion || !trimmedAnswer) return

    const entry = createLocalEntry(trimmedQuestion, { answer: trimmedAnswer })

    setCompletedTurns((prev) => [...prev, entry])
    pendingSaveRef.current = true
  }, [])

  return {
    liveTurn,
    activeModel,
    completedTurns,
    handleFrame,
    handleRunComplete,
    initialAgentSession,
    initialModel,
    startEntry,
    recordLocalAnswer,
    recordLocalError,
    ttsError,
    cycleModel,
  }
}
