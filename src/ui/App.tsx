import { useCallback, useMemo, useState } from 'react'
import { basename } from 'node:path'
import { Box, Text } from 'ink'

import { openInEditor, formatOpenOutcome } from '../services/editor'
import { latestFocusRefs, parseExplicitRefs } from '../services/file-refs'
import { FALLBACK_MODEL_CHOICES_BY_PROVIDER } from '../services/model-catalog'
import { buildResumeArgs } from '../services/relaunch'
import { listSessions, type SessionSummary } from '../services/session'
import { type AppConfig, type AppState, type DetailMode, type SavedSession } from '../types'
import type { AnimationMode } from './components/AsciiOrb'
import { ConversationRail } from './components/ConversationRail'
import { Footer } from './components/Footer'
import { SessionPicker } from './components/SessionPicker'
import { TTSErrorBanner } from './components/TTSErrorBanner'
import { WelcomeSplash } from './components/WelcomeSplash'
import { useConversation } from './hooks/useConversation'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { usePipeline } from './hooks/usePipeline'
import { useTerminalSize } from './hooks/useTerminalSize'
import { formatModelLabel } from './utils/model-label'

interface AppProps {
  config: AppConfig
  initialSession?: SavedSession | null
  orbSessionId?: string
  onRequestRelaunch?: (args: string[]) => void
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

const FIXED_UI_OVERHEAD = 8

export function App({ config, initialSession, orbSessionId, onRequestRelaunch }: AppProps) {
  const [detailMode, setDetailMode] = useState<DetailMode>('compact')
  const [state, setState] = useState<AppState>('idle')
  // Whether the input's `@`-file menu is open. Lifted here so the global Esc
  // handler can defer to the menu (the menu owns Esc while open).
  const [inputMenuOpen, setInputMenuOpen] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [splashDismissed, setSplashDismissed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pickerSessions, setPickerSessions] = useState<SessionSummary[] | null>(null)

  const conversation = useConversation({
    config,
    initialSession,
    orbSessionId,
    taskState: state,
  })

  const isPickerOpen = pickerSessions !== null

  const handleOpenSessions = useCallback(() => {
    void listSessions()
      .then((sessions) => setPickerSessions(sessions))
      .catch(() => setPickerSessions([]))
  }, [])

  const handlePickSession = useCallback(
    (session: SessionSummary) => {
      setPickerSessions(null)
      onRequestRelaunch?.(buildResumeArgs(session.projectPath, session.id))
    },
    [onRequestRelaunch],
  )

  const handleCancelPicker = useCallback(() => setPickerSessions(null), [])

  const handleStateChange = useCallback((next: AppState) => {
    setState(next)
    if (next === 'idle' || next === 'processing') setIsPaused(false)
    // A new turn supersedes any lingering "opened files" notice.
    if (next === 'processing') setNotice(null)
  }, [])

  // Files the most recent turn is "about" — what `^G` / bare `/open` act on.
  const focusRefs = useMemo(() => {
    const turns = conversation.liveTurn
      ? [...conversation.completedTurns, conversation.liveTurn]
      : conversation.completedTurns
    return latestFocusRefs(turns)
  }, [conversation.completedTurns, conversation.liveTurn])

  const handleOpenFiles = useCallback(
    async (args?: string) => {
      // Explicit args are authoritative — never fall back to focus refs, or
      // `/open Dockerfile` could silently open the previous turn's files.
      const trimmed = args?.trim() ?? ''
      const refs = trimmed ? parseExplicitRefs(trimmed) : focusRefs
      const outcome = await openInEditor(refs, { projectPath: config.projectPath })
      setNotice(formatOpenOutcome(outcome))
    },
    [focusRefs, config.projectPath],
  )

  const { cancel, pause, repeat, resume, stopPlayback, submit } = usePipeline({
    config,
    activeModel: conversation.activeModel,
    initialModel: conversation.initialModel,
    initialSession: conversation.initialAgentSession,
    onFrame: conversation.handleFrame,
    onRunComplete: conversation.handleRunComplete,
    onStateChange: handleStateChange,
    onSubmitBuiltin: conversation.recordLocalAnswer,
    onAction: handleOpenSessions,
    onSubmitError: conversation.recordLocalError,
    onOpenFiles: handleOpenFiles,
    startEntry: conversation.startEntry,
  })

  // ── Layout ──

  const { rows: terminalRows } = useTerminalSize()

  const liveToolCount = conversation.liveTurn?.toolCalls.length ?? 0
  const maxAnswerLines = useMemo(
    () => Math.max(5, terminalRows - FIXED_UI_OVERHEAD - liveToolCount),
    [terminalRows, liveToolCount],
  )

  const modelChoices =
    config.llmModelChoices && config.llmModelChoices.length > 0
      ? config.llmModelChoices
      : FALLBACK_MODEL_CHOICES_BY_PROVIDER[config.llmProvider]
  const canCycleModel = state === 'idle' && modelChoices.length > 1
  const isSpeakingState = state === 'speaking' || state === 'processing_speaking'
  const lastCompletedAnswer =
    conversation.completedTurns[conversation.completedTurns.length - 1]?.answer ?? ''
  const canTogglePause = config.ttsEnabled && isSpeakingState
  const canRepeat = config.ttsEnabled && state === 'idle' && lastCompletedAnswer.length > 0

  const handleCancel = useCallback(() => {
    setIsPaused(false)
    cancel()
  }, [cancel])

  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => {
      if (prev) resume()
      else pause()
      return !prev
    })
  }, [pause, resume])

  const handleRepeat = useCallback(() => {
    if (!lastCompletedAnswer) return
    void repeat(lastCompletedAnswer)
  }, [lastCompletedAnswer, repeat])

  const handlePromptEdit = useCallback(() => {
    if (!isPaused) return
    stopPlayback()
  }, [isPaused, stopPlayback])

  useKeyboardShortcuts({
    canCycleModel,
    canOpenFiles: focusRefs.length > 0,
    canRepeat,
    canTogglePause,
    enabled: !isPickerOpen,
    menuOpen: inputMenuOpen,
    onCancel: handleCancel,
    onCycleModel: conversation.cycleModel,
    onOpenFiles: () => void handleOpenFiles(),
    onRepeat: handleRepeat,
    onToggleDetailMode: () => setDetailMode((m) => (m === 'compact' ? 'expanded' : 'compact')),
    onTogglePause: handleTogglePause,
    state,
  })

  // ── Derived state ──

  const animationMode = useMemo(() => mapStateToAnimationMode(state), [state])
  const assistantLabel =
    config.llmProvider === 'anthropic'
      ? 'claude'
      : config.llmProvider === 'gemini'
        ? 'gemini'
        : 'openai'
  const projectName = useMemo(
    () => basename(config.projectPath) || config.projectPath,
    [config.projectPath],
  )
  const modelLabel = useMemo(
    () => formatModelLabel(config.llmProvider, conversation.activeModel, config.llmModelLabels),
    [config.llmProvider, conversation.activeModel, config.llmModelLabels],
  )

  const showWelcome =
    conversation.completedTurns.length === 0 &&
    !conversation.liveTurn &&
    !config.skipIntro &&
    !initialSession?.history?.length &&
    !splashDismissed

  // ── Rendering ──

  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1} paddingBottom={2}>
      {conversation.ttsError && (
        <TTSErrorBanner type={conversation.ttsError.type} message={conversation.ttsError.message} />
      )}
      {isPickerOpen ? (
        <SessionPicker
          sessions={pickerSessions ?? []}
          currentProjectPath={config.projectPath}
          currentId={orbSessionId}
          onSelect={handlePickSession}
          onCancel={handleCancelPicker}
        />
      ) : showWelcome ? (
        <WelcomeSplash
          animationMode={animationMode}
          assistantLabel={assistantLabel}
          projectName={projectName}
          modelLabel={modelLabel}
          ttsVoice={config.ttsVoice}
          ttsSpeed={config.ttsSpeed}
          ttsEnabled={config.ttsEnabled}
          onDismiss={() => setSplashDismissed(true)}
        />
      ) : (
        <ConversationRail
          completedTurns={conversation.completedTurns}
          liveTurn={conversation.liveTurn}
          detailMode={detailMode}
          maxAnswerLines={maxAnswerLines}
          assistantLabel={assistantLabel}
        />
      )}
      {!showWelcome && !isPickerOpen && (
        <Footer
          state={state}
          onSubmit={submit}
          onEdit={handlePromptEdit}
          model={conversation.activeModel}
          provider={config.llmProvider}
          modelLabels={config.llmModelLabels}
          canCycleModel={canCycleModel}
          canOpenFiles={focusRefs.length > 0}
          canTogglePause={canTogglePause}
          canRepeat={canRepeat}
          isPaused={isPaused}
          projectPath={config.projectPath}
          yolo={config.yolo}
          onMenuOpenChange={setInputMenuOpen}
        />
      )}
      {!showWelcome && !isPickerOpen && notice && (
        <Text color="gray" dimColor>
          {notice}
        </Text>
      )}
    </Box>
  )
}
