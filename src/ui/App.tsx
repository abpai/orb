import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Static, useInput } from 'ink'

import { createPipelineTask, type PipelineTask } from '../pipeline/task'
import { createTerminalTextTransport } from '../pipeline/transports/terminal-text'
import type { Transport } from '../pipeline/transports/types'
import { saveSession } from '../services/session'
import {
  ANTHROPIC_MODELS,
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

const ORB_PANEL_WIDTH = 32
const MIN_CONVERSATION_WIDTH = 40
const MIN_SPLIT_LAYOUT_WIDTH = ORB_PANEL_WIDTH + MIN_CONVERSATION_WIDTH + 3
const MIN_ORB_DISPLAY_WIDTH = MIN_SPLIT_LAYOUT_WIDTH + 20

export function isInputDisabled(state: AppState): boolean {
  return state !== 'idle'
}

export function App({ config, initialSession }: AppProps) {
  const sessionMatchesProvider = initialSession?.llmProvider === config.llmProvider
  const initialHistory = initialSession?.history ?? []
  const initialModel =
    (sessionMatchesProvider ? initialSession?.llmModel : undefined) ?? config.llmModel
  const initialAgentSession = sessionMatchesProvider ? initialSession?.agentSession : undefined

  // ── State ──

  const [state, setState] = useState<AppState>('idle')
  const [viewMode, setViewMode] = useState<ViewMode>('main')
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory)
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [ttsError, setTtsError] = useState<{ type: TTSErrorType; message: string } | null>(null)
  const [activeModel, setActiveModel] = useState<LlmModelId>(initialModel)

  // ── Layout ──

  const { columns: terminalWidth, rows: terminalRows } = useTerminalSize()
  const useStackedLayout = terminalWidth < MIN_SPLIT_LAYOUT_WIDTH
  const showOrb = terminalWidth >= MIN_ORB_DISPLAY_WIDTH

  const FIXED_UI_OVERHEAD = 12
  const maxAnswerLines = useMemo(
    () => Math.max(5, terminalRows - FIXED_UI_OVERHEAD),
    [terminalRows],
  )

  // ── Pipeline infrastructure ──

  const agentSessionRef = useRef<AgentSession | undefined>(initialAgentSession)
  const activeEntryIdRef = useRef<string | null>(null)
  const pendingSaveRef = useRef(false)

  const activeConfig = useMemo(() => ({ ...config, llmModel: activeModel }), [config, activeModel])

  // Create task and transport once (stable references)
  const { task, transport } = useMemo(() => {
    const t = createTerminalTextTransport()
    const tk = createPipelineTask({
      appConfig: { ...config, llmModel: initialModel },
      session: initialAgentSession,
      transport: t,
    })
    return { task: tk, transport: t }
  }, []) as { task: PipelineTask; transport: Transport }

  // Sync config changes to the task
  useEffect(() => {
    task.updateConfig(activeConfig)
  }, [task, activeConfig])

  // Subscribe to task state changes
  useEffect(() => {
    return task.onStateChange(setState)
  }, [task])

  // Subscribe to transport outbound frames for history updates
  useEffect(() => {
    return transport.onOutbound((frame) => {
      const entryId = activeEntryIdRef.current
      if (!entryId) return

      switch (frame.kind) {
        case 'agent-text-delta':
          setHistory((prev) =>
            prev.map((e) => (e.id === entryId ? { ...e, answer: frame.accumulatedText } : e)),
          )
          break

        case 'agent-text-complete':
          setHistory((prev) =>
            prev.map((e) => (e.id === entryId ? { ...e, answer: frame.text } : e)),
          )
          break

        case 'tool-call-start':
          setHistory((prev) =>
            prev.map((e) =>
              e.id === entryId ? { ...e, toolCalls: [...e.toolCalls, frame.toolCall] } : e,
            ),
          )
          break

        case 'tool-call-result':
          setHistory((prev) =>
            prev.map((e) => {
              if (e.id !== entryId) return e
              return {
                ...e,
                toolCalls: e.toolCalls.map((c) =>
                  c.index === frame.toolIndex
                    ? { ...c, status: frame.status, result: frame.result }
                    : c,
                ),
              }
            }),
          )
          break

        case 'agent-error':
          setHistory((prev) =>
            prev.map((e) => (e.id === entryId ? { ...e, error: frame.error.message } : e)),
          )
          break

        case 'tts-error':
          setTtsError({ type: frame.errorType, message: frame.message })
          break
      }
    })
  }, [transport])

  // ── Session persistence ──

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
    if (state !== 'idle') return
    pendingSaveRef.current = false
    void persistSession()
  }, [history, persistSession, state])

  // ── Actions ──

  const handleCancel = useCallback(() => {
    task.cancel()
  }, [task])

  const handleSubmit = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      if (!trimmed) return

      const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      activeEntryIdRef.current = entryId
      setActiveEntryId(entryId)
      setTtsError(null)

      setHistory((prev) => [
        ...prev,
        { id: entryId, question: trimmed, toolCalls: [], answer: '', error: null },
      ])

      const result = await task.run(trimmed, entryId)

      if (!result.cancelled) {
        // Update session ref for persistence
        if (result.session) {
          agentSessionRef.current = result.session
        }
        pendingSaveRef.current = true
      }
    },
    [task],
  )

  const cycleModel = useCallback(() => {
    if (activeConfig.llmProvider !== 'anthropic') return
    const currentIndex = ANTHROPIC_MODELS.indexOf(activeModel as AnthropicModel)
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % ANTHROPIC_MODELS.length
    const nextModel = ANTHROPIC_MODELS[nextIndex] ?? ANTHROPIC_MODELS[0]
    setActiveModel(nextModel)
    // Sync to task immediately so the next run uses the new model
    task.updateConfig({ ...config, llmModel: nextModel })
    void persistSession(nextModel, history)
  }, [activeConfig.llmProvider, activeModel, config, history, persistSession, task])

  // ── Keyboard handlers ──

  // Interrupt via Esc or Ctrl+S
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === 's')) {
        handleCancel()
      }
    },
    { isActive: viewMode === 'main' && state !== 'idle' },
  )

  // Ctrl+O to toggle transcript viewer
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

  // Shift+Tab to cycle models
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

  // Ctrl+C to exit
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        process.exit(0)
      }
    },
    { isActive: true },
  )

  // ── Derived state ──

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
  const inputDisabled = isInputDisabled(state)

  // ── Rendering ──

  function renderConversationLayout(): React.ReactNode {
    if (history.length === 0) {
      return (
        <>
          <WelcomeSplash animationMode={animationMode} />
          <InputPrompt onSubmit={handleSubmit} disabled={inputDisabled} />
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

    if (useStackedLayout) {
      return (
        <Box flexDirection="column">
          <ActiveMessagePanel
            entry={activeEntry}
            maxAnswerLines={maxAnswerLines}
            assistantLabel={assistantLabel}
          />
          <InputPrompt onSubmit={handleSubmit} disabled={inputDisabled} />
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
          <InputPrompt onSubmit={handleSubmit} disabled={inputDisabled} />
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
