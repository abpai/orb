import { useCallback, useMemo, useState } from 'react'
import { basename } from 'node:path'
import { Box, Text } from 'ink'

import { openInEditor, formatOpenOutcome } from '../services/editor'
import { latestFocusRefs, parseExplicitRefs } from '../services/file-refs'
import { FALLBACK_MODEL_CHOICES_BY_PROVIDER } from '../services/model-catalog'
import { buildResumeArgsForSession } from '../services/relaunch'
import { listSessions, type SessionSummary } from '../services/session'
import {
  type AppConfig,
  type AppState,
  type DetailMode,
  type ResumeInfo,
  type SavedSession,
} from '../types'
import type { AnimationMode } from './components/AsciiOrb'
import { ConversationRail } from './components/ConversationRail'
import { Footer } from './components/Footer'
import { ResumeBanner } from './components/ResumeBanner'
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
  /** Present when resuming an external session with empty scrollback. */
  resumeInfo?: ResumeInfo
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

// On resume, the saved history is seeded into `completedTurns` all at once and
// flushed into Ink's <Static> on mount. That first flush reconciles + lays out
// + serializes every historical TurnRow, so its cost is O(turns × answer size)
// — hundreds of ms to several seconds for a long session, which freezes input
// right after resuming. Steady-state typing is unaffected (Static prunes), so
// we only need to bound what the *initial* render materializes: keep the most
// recent turns visible and leave older ones to terminal scrollback. The full
// history is retained for `focusRefs`, model context, and persistence.
const MAX_RESUMED_RENDERED_TURNS = 50

export function App({
  config,
  initialSession,
  orbSessionId,
  resumeInfo,
  onRequestRelaunch,
}: AppProps) {
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

  // Fixed at mount: how many resumed turns to skip rendering. Using a stable
  // start index (not `slice(-N)`) keeps <Static> append-only — new turns this
  // session always render, while the older resumed tail stays in scrollback.
  const [renderStartIndex] = useState(() => {
    const restoredCount =
      initialSession?.llmProvider === config.llmProvider ? (initialSession.history?.length ?? 0) : 0
    return Math.max(0, restoredCount - MAX_RESUMED_RENDERED_TURNS)
  })
  const renderedCompletedTurns = useMemo(
    () => conversation.completedTurns.slice(renderStartIndex),
    [conversation.completedTurns, renderStartIndex],
  )

  const isPickerOpen = pickerSessions !== null

  const handleOpenSessions = useCallback(() => {
    void listSessions(undefined, config.projectPath)
      .then((sessions) => setPickerSessions(sessions))
      .catch(() => setPickerSessions([]))
  }, [config.projectPath])

  const handlePickSession = useCallback(
    (session: SessionSummary) => {
      setPickerSessions(null)
      onRequestRelaunch?.(buildResumeArgsForSession(session))
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
    !resumeInfo &&
    !splashDismissed

  // Reassure the user that a resumed external session's hidden history is still
  // in the model's context — until they take the first turn.
  const showResumeBanner =
    resumeInfo !== undefined &&
    !isPickerOpen &&
    conversation.completedTurns.length === 0 &&
    !conversation.liveTurn

  // ── Rendering ──

  return (
    <Box flexDirection="column" paddingX={1} paddingTop={1} paddingBottom={2}>
      {conversation.ttsError && (
        <TTSErrorBanner type={conversation.ttsError.type} message={conversation.ttsError.message} />
      )}
      {showResumeBanner && resumeInfo && <ResumeBanner info={resumeInfo} />}
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
          completedTurns={renderedCompletedTurns}
          hiddenTurnCount={renderStartIndex}
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
