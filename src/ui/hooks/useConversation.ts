import { useCallback, useEffect, useRef, useState } from 'react'

import type { OutboundFrame } from '../../pipeline/transports/types'
import type { RunResult } from '../../pipeline/task'
import { saveSession } from '../../services/session'
import {
  ANTHROPIC_MODELS,
  type AgentSession,
  type AnthropicModel,
  type AppConfig,
  type AppState,
  type HistoryEntry,
  type LlmModelId,
  type SavedSession,
  type TTSErrorType,
} from '../../types'

interface UseConversationConfig {
  config: AppConfig
  initialSession?: SavedSession | null
  taskState: AppState
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

export function useConversation({ config, initialSession, taskState }: UseConversationConfig) {
  const sessionMatchesProvider = initialSession?.llmProvider === config.llmProvider
  const initialHistory = initialSession?.history ?? []
  const initialModel =
    (sessionMatchesProvider ? initialSession?.llmModel : undefined) ?? config.llmModel
  const initialAgentSession = sessionMatchesProvider ? initialSession?.agentSession : undefined

  const [completedTurns, setCompletedTurns] = useState<HistoryEntry[]>(initialHistory)
  const [liveTurn, setLiveTurn] = useState<HistoryEntry | null>(null)
  const [ttsError, setTtsError] = useState<{ type: TTSErrorType; message: string } | null>(null)
  const [activeModel, setActiveModel] = useState<LlmModelId>(initialModel)

  const liveTurnRef = useRef<HistoryEntry | null>(null)
  const activeEntryIdRef = useRef<string | null>(null)
  const agentSessionRef = useRef<AgentSession | undefined>(initialAgentSession)
  const pendingSaveRef = useRef(false)
  const pendingRenderTurnRef = useRef<HistoryEntry | null>(null)
  const flushScheduledRef = useRef(false)

  /** Update both ref (synchronous, for archive guards) and state (async, for render). */
  const updateLiveTurn = useCallback((turn: HistoryEntry | null) => {
    liveTurnRef.current = turn
    setLiveTurn(turn)
  }, [])

  /**
   * Coalesce rapid agent-text-delta updates into one render per event-loop tick.
   * Without this, 20–50 Hz token bursts reconcile the whole tree and crowd out
   * keystroke-driven renders, making typing feel laggy during streaming.
   */
  const scheduleRenderFlush = useCallback(() => {
    if (flushScheduledRef.current) return
    flushScheduledRef.current = true
    setImmediate(() => {
      flushScheduledRef.current = false
      const pending = pendingRenderTurnRef.current
      pendingRenderTurnRef.current = null
      if (pending && liveTurnRef.current !== null) {
        setLiveTurn(pending)
      }
    })
  }, [])

  const getHistorySnapshot = useCallback(
    () => [...completedTurns, ...(liveTurnRef.current ? [liveTurnRef.current] : [])],
    [completedTurns],
  )

  const persistSession = useCallback(
    async (modelOverride?: LlmModelId, historyOverride?: HistoryEntry[]) => {
      const history = historyOverride ?? getHistorySnapshot()
      const payload: SavedSession = {
        version: 2,
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
        console.warn('Failed to save session:', err)
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

  const startEntry = useCallback((query: string) => {
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
    updateLiveTurn(newTurn)
    setTtsError(null)

    return { entryId, query: trimmed }
  }, [])

  const handleFrame = useCallback(
    (frame: OutboundFrame) => {
      if (!liveTurnRef.current) return
      const cur = liveTurnRef.current

      // Any non-delta frame supersedes a coalesced delta; only agent-text-delta
      // re-arms the pending ref below.
      if (frame.kind !== 'agent-text-delta' && frame.kind !== 'tts-error') {
        pendingRenderTurnRef.current = null
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
              tc.index === frame.toolIndex
                ? { ...tc, status: frame.status, result: frame.result }
                : tc,
            ),
          })
          break

        case 'agent-error':
          updateLiveTurn({ ...cur, error: frame.error.message })
          break

        case 'tts-error':
          setTtsError({ type: frame.errorType, message: frame.message })
          break
      }
    },
    [scheduleRenderFlush, updateLiveTurn],
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
      setCompletedTurns((prev) => [...prev, turnToArchive])
      updateLiveTurn(null)

      if (!result.cancelled) {
        pendingSaveRef.current = true
      }
    },
    [updateLiveTurn],
  )

  const cycleModel = useCallback(() => {
    if (config.llmProvider !== 'anthropic') return

    const currentIndex = ANTHROPIC_MODELS.indexOf(activeModel as AnthropicModel)
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % ANTHROPIC_MODELS.length
    const nextModel = ANTHROPIC_MODELS[nextIndex] ?? ANTHROPIC_MODELS[0]
    setActiveModel(nextModel)

    void persistSession(nextModel, getHistorySnapshot())
  }, [activeModel, config.llmProvider, getHistorySnapshot, persistSession])

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
