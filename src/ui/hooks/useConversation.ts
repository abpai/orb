import { useCallback, useEffect, useRef, useState } from 'react'

import type { OutboundFrame } from '../../pipeline/transports/types'
import type { RunResult } from '../../pipeline/task'
import { FALLBACK_MODEL_CHOICES_BY_PROVIDER } from '../../services/model-catalog'
import { saveSession } from '../../services/session'
import {
  type AgentSession,
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

function getModelChoices(config: AppConfig): LlmModelId[] {
  return config.llmModelChoices && config.llmModelChoices.length > 0
    ? config.llmModelChoices
    : FALLBACK_MODEL_CHOICES_BY_PROVIDER[config.llmProvider]
}

function semanticFamily(provider: AppConfig['llmProvider'], model: LlmModelId): string | null {
  if (provider === 'anthropic') {
    return model.match(/^claude-(haiku|sonnet|opus)-/)?.[1] ?? null
  }

  if (provider === 'openai') {
    if (/^gpt-\d/.test(model) && model.includes('codex')) return 'codex'
    if (/^gpt-\d/.test(model) && model.includes('mini')) return 'mini'
    if (/^gpt-\d/.test(model) && model.includes('nano')) return 'nano'
    if (/^gpt-\d/.test(model) && model.includes('pro')) return 'pro'
    if (/^gpt-\d/.test(model)) return 'gpt'
    return null
  }

  if (provider === 'gemini') {
    if (!model.startsWith('gemini-') || model.includes('image')) return null
    if (model.includes('flash-lite')) return 'flash-lite'
    if (model.includes('flash')) return 'flash'
    if (model.includes('pro')) return 'pro'
  }

  return null
}

function shouldRestoreSessionModel(config: AppConfig, model?: LlmModelId): model is LlmModelId {
  if (!model) return false

  const modelChoices = getModelChoices(config)
  if (modelChoices.includes(model)) return true

  const family = semanticFamily(config.llmProvider, model)
  if (!family) return true

  return !modelChoices.some((choice) => semanticFamily(config.llmProvider, choice) === family)
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
  const initialHistory = sessionMatchesProvider ? (initialSession?.history ?? []) : []
  const sessionModel = sessionMatchesProvider ? initialSession?.llmModel : undefined
  const initialModel = shouldRestoreSessionModel(config, sessionModel)
    ? sessionModel
    : config.llmModel
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
              tc.id === frame.toolId ? { ...tc, status: frame.status, result: frame.result } : tc,
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
