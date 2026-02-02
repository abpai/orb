import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Static, useInput } from 'ink'

import { runAgent } from '../services/agent'
import { saveSession } from '../services/session'
import {
  createStreamingSpeechController,
  type StreamingSpeechController,
} from '../services/streaming-tts'
import { speak, stopSpeaking } from '../services/tts'
import {
  ANTHROPIC_MODELS,
  TTSError,
  type AppConfig,
  type AppState,
  type AgentSession,
  type AnthropicModel,
  type HistoryEntry,
  type LlmModelId,
  type SavedSession,
  type TTSErrorType,
  type ViewMode,
} from '../types'
import { ActiveMessagePanel } from './components/ActiveMessagePanel'
import type { AnimationMode } from './components/AsciiOrb'
import { CompletedEntry } from './components/CompletedEntry'
import { InputPrompt } from './components/InputPrompt'
import { OrbPanel } from './components/OrbPanel'
import { ResonanceBar } from './components/ResonanceBar'
import { TranscriptViewer } from './components/TranscriptViewer'
import { TTSErrorBanner } from './components/TTSErrorBanner'
import { WelcomeSplash } from './components/WelcomeSplash'
import { useTerminalSize } from './hooks/useTerminalSize'

interface AppProps {
  config: AppConfig
  initialSession?: SavedSession | null
}

function mapStateToAnimationMode(state: AppState): AnimationMode {
  switch (state) {
    case 'speaking':
    case 'processing_speaking':
      return 'speaking'
    case 'processing':
      return 'processing'
    case 'idle':
      return 'idle'
  }
}

function isAbortError(err: unknown): boolean {
  if (!err) return false
  if (err instanceof Error && err.name === 'AbortError') return true
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return message.includes('abort')
}

const ORB_PANEL_WIDTH = 32
const MIN_CONVERSATION_WIDTH = 40
const MIN_SPLIT_LAYOUT_WIDTH = ORB_PANEL_WIDTH + MIN_CONVERSATION_WIDTH + 3
const MIN_ORB_DISPLAY_WIDTH = MIN_SPLIT_LAYOUT_WIDTH + 20 // ~95 chars - hide orb in narrow split layouts

export function App({ config, initialSession }: AppProps) {
  const sessionMatchesProvider = initialSession?.llmProvider === config.llmProvider
  const initialHistory = initialSession?.history ?? []
  const initialModel =
    (sessionMatchesProvider ? initialSession?.llmModel : undefined) ?? config.llmModel
  const initialAgentSession = sessionMatchesProvider ? initialSession?.agentSession : undefined

  const [state, setState] = useState<AppState>('idle')
  const [viewMode, setViewMode] = useState<ViewMode>('main')
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory)
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [ttsError, setTtsError] = useState<{ type: TTSErrorType; message: string } | null>(null)
  const [activeModel, setActiveModel] = useState<LlmModelId>(initialModel)

  const { columns: terminalWidth, rows: terminalRows } = useTerminalSize()
  const useStackedLayout = terminalWidth < MIN_SPLIT_LAYOUT_WIDTH
  const showOrb = terminalWidth >= MIN_ORB_DISPLAY_WIDTH

  // Calculate max lines for active response to prevent pushing UI off-screen
  // Fixed overhead: padding (2), input (3), status bar (1), question box (3), margins (3) = ~12
  const FIXED_UI_OVERHEAD = 12
  const maxAnswerLines = useMemo(
    () => Math.max(5, terminalRows - FIXED_UI_OVERHEAD),
    [terminalRows],
  )

  const agentSessionRef = useRef<AgentSession | undefined>(initialAgentSession)
  const activeConfig = useMemo(() => ({ ...config, llmModel: activeModel }), [config, activeModel])

  const abortControllerRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)

  // Track accumulated streamed text (accessible outside React state closure)
  const streamedTextRef = useRef('')
  // Buffer streamed text to avoid re-rendering on every chunk
  const pendingTextRef = useRef('')
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Streaming speech controller ref for interrupt handling
  const speechControllerRef = useRef<StreamingSpeechController | null>(null)
  const pendingSaveRef = useRef(false)

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

  const updateEntry = useCallback((entryId: string, updates: Partial<HistoryEntry>) => {
    setHistory((prev) =>
      prev.map((entry) => (entry.id === entryId ? { ...entry, ...updates } : entry)),
    )
  }, [])

  const updateToolCallResult = useCallback(
    (entryId: string, index: number, result: string, status: 'complete' | 'error') => {
      setHistory((prev) =>
        prev.map((entry) => {
          if (entry.id !== entryId) return entry
          return {
            ...entry,
            toolCalls: entry.toolCalls.map((c) =>
              c.index === index ? { ...c, status, result } : c,
            ),
          }
        }),
      )
    },
    [],
  )

  const clearFlushTimeout = useCallback(() => {
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }
  }, [])

  const cycleModel = useCallback(() => {
    if (activeConfig.llmProvider !== 'anthropic') return
    const currentIndex = ANTHROPIC_MODELS.indexOf(activeModel as AnthropicModel)
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % ANTHROPIC_MODELS.length
    const nextModel = ANTHROPIC_MODELS[nextIndex] ?? ANTHROPIC_MODELS[0]
    setActiveModel(nextModel)
    void persistSession(nextModel, history)
  }, [activeConfig.llmProvider, activeModel, history, persistSession])

  useEffect(() => {
    if (!pendingSaveRef.current) return
    if (state !== 'idle') return
    pendingSaveRef.current = false
    void persistSession()
  }, [history, persistSession, state])

  const flushPendingText = useCallback(
    (entryId: string, expectedRunId: number) => {
      if (expectedRunId !== runIdRef.current) return
      if (!pendingTextRef.current) return

      const next = streamedTextRef.current
      const pending = pendingTextRef.current
      pendingTextRef.current = ''
      clearFlushTimeout()
      speechControllerRef.current?.feedText(pending)
      updateEntry(entryId, { answer: next })
    },
    [clearFlushTimeout, updateEntry],
  )

  const cancelCurrentRun = useCallback(() => {
    runIdRef.current += 1
    abortControllerRef.current?.abort()
    abortControllerRef.current = null

    speechControllerRef.current?.stop()
    speechControllerRef.current = null
    stopSpeaking()

    streamedTextRef.current = ''
    pendingTextRef.current = ''
    clearFlushTimeout()

    setState('idle')
  }, [clearFlushTimeout])

  // Handle interrupt via Esc or Ctrl+S
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === 's')) {
        cancelCurrentRun()
      }
    },
    { isActive: viewMode === 'main' && state !== 'idle' },
  )

  // Handle Ctrl+O to toggle transcript viewer (only when idle and in main view)
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'o') {
        setViewMode('transcript')
      }
    },
    { isActive: state === 'idle' && viewMode === 'main' },
  )

  const canCycleModel =
    state === 'idle' && viewMode === 'main' && activeConfig.llmProvider === 'anthropic'

  // Handle Shift+Tab to cycle models (only when idle and in main view)
  useInput(
    (input, key) => {
      const isShiftTab =
        (key.shift && key.tab) || input === '\u001b[Z' || (key.shift && input === '\t')
      if (isShiftTab) {
        cycleModel()
      }
    },
    { isActive: canCycleModel },
  )

  // Handle Ctrl+C to exit application
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        process.exit(0)
      }
    },
    { isActive: true },
  )

  const handleSubmit = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      if (!trimmed) return

      if (abortControllerRef.current || speechControllerRef.current || state !== 'idle') {
        cancelCurrentRun()
      }

      const runId = (runIdRef.current += 1)

      setState('processing')
      setTtsError(null)
      streamedTextRef.current = ''
      pendingTextRef.current = ''
      clearFlushTimeout()
      const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setActiveEntryId(entryId)

      setHistory((prev) => [
        ...prev,
        { id: entryId, question: trimmed, toolCalls: [], answer: '', error: null },
      ])

      const abortController = new AbortController()
      abortControllerRef.current = abortController

      // Create streaming speech controller if streaming is enabled
      const useStreaming = activeConfig.ttsEnabled && activeConfig.ttsStreamingEnabled
      const controller = useStreaming
        ? createStreamingSpeechController(activeConfig, {
            onSpeakingStart: () => {
              if (runId !== runIdRef.current) return
              setState((prev) => (prev === 'processing' ? 'processing_speaking' : 'speaking'))
            },
            onSpeakingEnd: () => {
              if (runId !== runIdRef.current) return
              setState((prev) => {
                if (prev === 'processing_speaking') return 'processing'
                if (prev === 'speaking') return 'idle'
                return prev
              })
            },
            onError: (err) => {
              if (runId !== runIdRef.current) return
              setTtsError({ type: err.type, message: err.message })
            },
          })
        : null

      speechControllerRef.current = controller

      const onAssistantText = (text: string) => {
        if (runId !== runIdRef.current) return
        streamedTextRef.current += text
        pendingTextRef.current += text

        if (!flushTimeoutRef.current) {
          flushTimeoutRef.current = setTimeout(() => {
            flushPendingText(entryId, runId)
          }, 150)
        }
      }

      try {
        const { text: result, session } = await runAgent(
          trimmed,
          activeConfig,
          agentSessionRef.current,
          {
            onSessionId: (id) => {
              if (runId !== runIdRef.current) return
              if (activeConfig.llmProvider !== 'anthropic') return
              agentSessionRef.current = { provider: 'anthropic', sessionId: id }
            },
            onToolCall: (call) => {
              if (runId !== runIdRef.current) return
              setHistory((prev) =>
                prev.map((entry) =>
                  entry.id === entryId
                    ? { ...entry, toolCalls: [...entry.toolCalls, call] }
                    : entry,
                ),
              )
            },
            onToolResult: (index, resultText) => {
              if (runId !== runIdRef.current) return
              updateToolCallResult(entryId, index, resultText, 'complete')
            },
            onToolError: (index, errorText) => {
              if (runId !== runIdRef.current) return
              updateToolCallResult(entryId, index, errorText, 'error')
            },
            onAssistantText,
          },
          abortController,
        )

        if (runId !== runIdRef.current) return

        if (session) {
          agentSessionRef.current = session
        }

        if (pendingTextRef.current) {
          flushPendingText(entryId, runId)
        }

        if (result && result !== streamedTextRef.current) {
          updateEntry(entryId, { answer: result })
        }

        if (useStreaming && controller) {
          controller.finalize()
          if (controller.isActive()) {
            setState('speaking')
            await controller.waitForCompletion()
          }
        } else if (activeConfig.ttsEnabled) {
          setState('speaking')
          await speak(streamedTextRef.current || result, activeConfig)
        }

        if (runId !== runIdRef.current) return
        setState('idle')
        pendingSaveRef.current = true
      } catch (err) {
        if (runId !== runIdRef.current) return

        const wasAborted = isAbortError(err)

        if (!wasAborted) {
          updateEntry(entryId, {
            error: err instanceof Error ? err.message : String(err),
          })
        }

        if (err instanceof TTSError) {
          setTtsError({ type: err.type, message: err.message })
        }
        setState('idle')
        if (!wasAborted) {
          pendingSaveRef.current = true
        }
      } finally {
        if (runId === runIdRef.current) {
          abortControllerRef.current = null
          speechControllerRef.current = null
          clearFlushTimeout()
        }
      }
    },
    [
      cancelCurrentRun,
      clearFlushTimeout,
      activeConfig,
      flushPendingText,
      state,
      updateEntry,
      updateToolCallResult,
    ],
  )

  const activeEntry = useMemo(
    () => (activeEntryId ? (history.find((e) => e.id === activeEntryId) ?? null) : null),
    [activeEntryId, history],
  )

  const completedEntries = useMemo(
    () => history.filter((e) => e.id !== activeEntryId),
    [activeEntryId, history],
  )

  const animationMode = useMemo(() => mapStateToAnimationMode(state), [state])
  const assistantLabel = activeConfig.llmProvider === 'anthropic' ? 'claude' : 'openai'

  function renderConversationLayout(): React.ReactNode {
    // Welcome screen - centered orb
    if (history.length === 0) {
      return (
        <>
          <WelcomeSplash animationMode={animationMode} />
          <InputPrompt onSubmit={handleSubmit} disabled={false} />
          <ResonanceBar
            status={state}
            hasHistory={false}
            model={activeModel}
            provider={activeConfig.llmProvider}
            canCycleModel={canCycleModel}
          />
        </>
      )
    }

    // Stacked layout for narrow terminals
    if (useStackedLayout) {
      return (
        <Box flexDirection="column">
          <ActiveMessagePanel
            entry={activeEntry}
            maxAnswerLines={maxAnswerLines}
            assistantLabel={assistantLabel}
          />
          <InputPrompt onSubmit={handleSubmit} disabled={false} />
          <ResonanceBar
            status={state}
            hasHistory={true}
            model={activeModel}
            provider={activeConfig.llmProvider}
            canCycleModel={canCycleModel}
          />
        </Box>
      )
    }

    // Split panel - orb left (when wide enough), conversation right
    return (
      <Box flexDirection="row">
        {showOrb && <OrbPanel animationMode={animationMode} />}
        <Box
          flexDirection="column"
          flexGrow={1}
          marginLeft={showOrb ? 1 : 0}
          minWidth={MIN_CONVERSATION_WIDTH}
        >
          <ActiveMessagePanel
            entry={activeEntry}
            maxAnswerLines={maxAnswerLines}
            assistantLabel={assistantLabel}
          />
          <InputPrompt onSubmit={handleSubmit} disabled={false} />
          <ResonanceBar
            status={state}
            hasHistory={true}
            model={activeModel}
            provider={activeConfig.llmProvider}
            canCycleModel={canCycleModel}
          />
        </Box>
      </Box>
    )
  }

  const mainContent = (
    <>
      {ttsError && <TTSErrorBanner type={ttsError.type} message={ttsError.message} />}
      <Static items={completedEntries}>
        {(entry) => <CompletedEntry key={entry.id} entry={entry} assistantLabel={assistantLabel} />}
      </Static>
      {renderConversationLayout()}
    </>
  )

  const transcriptContent = (
    <TranscriptViewer
      entries={history}
      onClose={() => setViewMode('main')}
      assistantLabel={assistantLabel}
    />
  )

  return (
    <Box flexDirection="column" padding={1}>
      {viewMode === 'transcript' ? transcriptContent : mainContent}
    </Box>
  )
}
