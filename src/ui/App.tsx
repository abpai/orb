import { useMemo, useState } from 'react'
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

export function isInputDisabled(state: AppState): boolean {
  return state !== 'idle'
}

export function App({ config, initialSession }: AppProps) {
  const [detailMode, setDetailMode] = useState<DetailMode>('compact')
  const [state, setState] = useState<AppState>('idle')
  const [splashDismissed, setSplashDismissed] = useState(false)

  const conversation = useConversation({
    config,
    initialSession,
    taskState: state,
  })

  const { cancel, submit } = usePipeline({
    config,
    activeModel: conversation.activeModel,
    initialModel: conversation.initialModel,
    initialSession: conversation.initialAgentSession,
    onFrame: conversation.handleFrame,
    onRunComplete: conversation.handleRunComplete,
    onStateChange: setState,
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

  useKeyboardShortcuts({
    canCycleModel,
    onCancel: cancel,
    onCycleModel: conversation.cycleModel,
    onToggleDetailMode: () => setDetailMode((m) => (m === 'compact' ? 'expanded' : 'compact')),
    state,
  })

  // ── Derived state ──

  const animationMode = useMemo(() => mapStateToAnimationMode(state), [state])
  const assistantLabel = config.llmProvider === 'anthropic' ? 'claude' : 'openai'
  const inputDisabled = isInputDisabled(state)
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
    <Box flexDirection="column" padding={1}>
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
          inputDisabled={inputDisabled}
          model={conversation.activeModel}
          provider={config.llmProvider}
          canCycleModel={canCycleModel}
        />
      )}
    </Box>
  )
}
