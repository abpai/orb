import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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

export function useConversation({ config, initialSession, taskState }: UseConversationConfig) {
  const sessionMatchesProvider = initialSession?.llmProvider === config.llmProvider
  const initialHistory = initialSession?.history ?? []
  const initialModel =
    (sessionMatchesProvider ? initialSession?.llmModel : undefined) ?? config.llmModel
  const initialAgentSession = sessionMatchesProvider ? initialSession?.agentSession : undefined

  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory)
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [ttsError, setTtsError] = useState<{ type: TTSErrorType; message: string } | null>(null)
  const [activeModel, setActiveModel] = useState<LlmModelId>(initialModel)

  const agentSessionRef = useRef<AgentSession | undefined>(initialAgentSession)
  const activeEntryIdRef = useRef<string | null>(null)
  const pendingSaveRef = useRef(false)

  const updateHistoryEntry = useCallback(
    (entryId: string, update: (entry: HistoryEntry) => HistoryEntry) => {
      setHistory((prev) => prev.map((entry) => (entry.id === entryId ? update(entry) : entry)))
    },
    [],
  )

  const persistSession = useCallback(
    async (modelOverride?: LlmModelId, historyOverride?: HistoryEntry[]) => {
      const payload: SavedSession = {
        version: 2,
        projectPath: config.projectPath,
        llmProvider: config.llmProvider,
        llmModel: modelOverride ?? activeModel,
        agentSession: agentSessionRef.current,
        lastModified: new Date().toISOString(),
        history: historyOverride ?? history,
      }

      try {
        await saveSession(payload)
      } catch (err) {
        console.warn('Failed to save session:', err)
      }
    },
    [activeModel, config.llmProvider, config.projectPath, history],
  )

  useEffect(() => {
    if (!pendingSaveRef.current) return
    if (taskState !== 'idle') return
    pendingSaveRef.current = false
    void persistSession()
  }, [history, persistSession, taskState])

  const startEntry = useCallback((query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return null

    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    activeEntryIdRef.current = entryId
    setActiveEntryId(entryId)
    setTtsError(null)

    setHistory((prev) => [
      ...prev,
      { id: entryId, question: trimmed, toolCalls: [], answer: '', error: null },
    ])

    return { entryId, query: trimmed }
  }, [])

  const handleFrame = useCallback(
    (frame: OutboundFrame) => {
      const entryId = activeEntryIdRef.current
      if (!entryId) return

      switch (frame.kind) {
        case 'agent-text-delta':
          updateHistoryEntry(entryId, (entry) => ({ ...entry, answer: frame.accumulatedText }))
          break

        case 'agent-text-complete':
          updateHistoryEntry(entryId, (entry) => ({ ...entry, answer: frame.text }))
          break

        case 'tool-call-start':
          updateHistoryEntry(entryId, (entry) => ({
            ...entry,
            toolCalls: [...entry.toolCalls, frame.toolCall],
          }))
          break

        case 'tool-call-result':
          updateHistoryEntry(entryId, (entry) => ({
            ...entry,
            toolCalls: entry.toolCalls.map((toolCall) =>
              toolCall.index === frame.toolIndex
                ? { ...toolCall, status: frame.status, result: frame.result }
                : toolCall,
            ),
          }))
          break

        case 'agent-error':
          updateHistoryEntry(entryId, (entry) => ({ ...entry, error: frame.error.message }))
          break

        case 'tts-error':
          setTtsError({ type: frame.errorType, message: frame.message })
          break
      }
    },
    [updateHistoryEntry],
  )

  const handleRunComplete = useCallback((result: RunResult) => {
    if (result.cancelled) return

    if (result.session) {
      agentSessionRef.current = result.session
    }

    pendingSaveRef.current = true
  }, [])

  const cycleModel = useCallback(() => {
    if (config.llmProvider !== 'anthropic') return

    const currentIndex = ANTHROPIC_MODELS.indexOf(activeModel as AnthropicModel)
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % ANTHROPIC_MODELS.length
    const nextModel = ANTHROPIC_MODELS[nextIndex] ?? ANTHROPIC_MODELS[0]
    setActiveModel(nextModel)
    void persistSession(nextModel, history)
  }, [activeModel, config.llmProvider, history, persistSession])

  const activeEntry = useMemo(
    () => (activeEntryId ? (history.find((entry) => entry.id === activeEntryId) ?? null) : null),
    [activeEntryId, history],
  )

  const completedEntries = useMemo(
    () => history.filter((entry) => entry.id !== activeEntryId),
    [activeEntryId, history],
  )

  return {
    activeEntry,
    activeModel,
    completedEntries,
    handleFrame,
    handleRunComplete,
    history,
    initialAgentSession,
    initialModel,
    startEntry,
    ttsError,
    cycleModel,
  }
}
