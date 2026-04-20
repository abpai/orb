import { useCallback, useMemo, useState } from 'react'
import { basename } from 'node:path'
import { Box } from 'ink'

import { type AppConfig, type AppState, type DetailMode, type SavedSession } from '../types'
import type { AnimationMode } from './components/AsciiOrb'
import { ConversationRail } from './components/ConversationRail'
import { Footer } from './components/Footer'
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

export function App({ config, initialSession }: AppProps) {
  const [detailMode, setDetailMode] = useState<DetailMode>('compact')
  const [state, setState] = useState<AppState>('idle')
  const [isPaused, setIsPaused] = useState(false)
  const [splashDismissed, setSplashDismissed] = useState(false)

  const conversation = useConversation({
    config,
    initialSession,
    taskState: state,
  })

  const handleStateChange = useCallback((next: AppState) => {
    setState(next)
    // Clear pause indicator when playback ends (state returns to idle/processing).
    if (next === 'idle' || next === 'processing') setIsPaused(false)
  }, [])

  const { cancel, pause, repeat, resume, submit } = usePipeline({
    config,
    activeModel: conversation.activeModel,
    initialModel: conversation.initialModel,
    initialSession: conversation.initialAgentSession,
    onFrame: conversation.handleFrame,
    onRunComplete: conversation.handleRunComplete,
    onStateChange: handleStateChange,
    startEntry: conversation.startEntry,
  })

  // ── Layout ──

  const { rows: terminalRows } = useTerminalSize()

  const liveToolCount = conversation.liveTurn?.toolCalls.length ?? 0
  const maxAnswerLines = useMemo(
    () => Math.max(5, terminalRows - FIXED_UI_OVERHEAD - liveToolCount),
    [terminalRows, liveToolCount],
  )

  const canCycleModel = state === 'idle' && config.llmProvider === 'anthropic'
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

  useKeyboardShortcuts({
    canCycleModel,
    canRepeat,
    canTogglePause,
    onCancel: handleCancel,
    onCycleModel: conversation.cycleModel,
    onRepeat: handleRepeat,
    onToggleDetailMode: () => setDetailMode((m) => (m === 'compact' ? 'expanded' : 'compact')),
    onTogglePause: handleTogglePause,
    state,
  })

  // ── Derived state ──

  const animationMode = useMemo(() => mapStateToAnimationMode(state), [state])
  const assistantLabel = config.llmProvider === 'anthropic' ? 'claude' : 'openai'
  const projectName = useMemo(
    () => basename(config.projectPath) || config.projectPath,
    [config.projectPath],
  )
  const modelLabel = useMemo(
    () => formatModelLabel(config.llmProvider, conversation.activeModel),
    [config.llmProvider, conversation.activeModel],
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
      {showWelcome ? (
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
      {!showWelcome && (
        <Footer
          state={state}
          onSubmit={submit}
          model={conversation.activeModel}
          provider={config.llmProvider}
          canCycleModel={canCycleModel}
          canTogglePause={canTogglePause}
          canRepeat={canRepeat}
          isPaused={isPaused}
        />
      )}
    </Box>
  )
}
