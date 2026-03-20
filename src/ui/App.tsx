import React, { useMemo, useState } from 'react'
import { Box, Static } from 'ink'

import { type AppConfig, type AppState, type SavedSession, type ViewMode } from '../types'
import { ActiveMessagePanel } from './components/ActiveMessagePanel'
import type { AnimationMode } from './components/AsciiOrb'
import { CompletedEntry } from './components/CompletedEntry'
import { InputPrompt } from './components/InputPrompt'
import { OrbPanel } from './components/OrbPanel'
import { ResonanceBar } from './components/ResonanceBar'
import { TranscriptViewer } from './components/TranscriptViewer'
import { TTSErrorBanner } from './components/TTSErrorBanner'
import { WelcomeSplash } from './components/WelcomeSplash'
import { useConversation } from './hooks/useConversation'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { usePipeline } from './hooks/usePipeline'
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
  const [viewMode, setViewMode] = useState<ViewMode>('main')
  const [state, setState] = useState<AppState>('idle')

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

  const { columns: terminalWidth, rows: terminalRows } = useTerminalSize()
  const useStackedLayout = terminalWidth < MIN_SPLIT_LAYOUT_WIDTH
  const showOrb = terminalWidth >= MIN_ORB_DISPLAY_WIDTH

  const FIXED_UI_OVERHEAD = 12
  const maxAnswerLines = useMemo(
    () => Math.max(5, terminalRows - FIXED_UI_OVERHEAD),
    [terminalRows],
  )

  const canCycleModel =
    state === 'idle' && viewMode === 'main' && config.llmProvider === 'anthropic'

  useKeyboardShortcuts({
    canCycleModel,
    onCancel: cancel,
    onCycleModel: conversation.cycleModel,
    onOpenTranscript: () => setViewMode('transcript'),
    state,
    viewMode,
  })

  // ── Derived state ──

  const animationMode = useMemo(() => mapStateToAnimationMode(state), [state])
  const assistantLabel = config.llmProvider === 'anthropic' ? 'claude' : 'openai'
  const inputDisabled = isInputDisabled(state)

  // ── Rendering ──

  function renderConversationLayout(): React.ReactNode {
    if (conversation.history.length === 0) {
      return (
        <>
          <WelcomeSplash animationMode={animationMode} />
          <InputPrompt onSubmit={submit} disabled={inputDisabled} />
          <ResonanceBar
            status={state}
            hasHistory={false}
            model={conversation.activeModel}
            provider={config.llmProvider}
            canCycleModel={canCycleModel}
          />
        </>
      )
    }

    if (useStackedLayout) {
      return (
        <Box flexDirection="column">
          <ActiveMessagePanel
            entry={conversation.activeEntry}
            maxAnswerLines={maxAnswerLines}
            assistantLabel={assistantLabel}
          />
          <InputPrompt onSubmit={submit} disabled={inputDisabled} />
          <ResonanceBar
            status={state}
            hasHistory={true}
            model={conversation.activeModel}
            provider={config.llmProvider}
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
            entry={conversation.activeEntry}
            maxAnswerLines={maxAnswerLines}
            assistantLabel={assistantLabel}
          />
          <InputPrompt onSubmit={submit} disabled={inputDisabled} />
          <ResonanceBar
            status={state}
            hasHistory={true}
            model={conversation.activeModel}
            provider={config.llmProvider}
            canCycleModel={canCycleModel}
          />
        </Box>
      </Box>
    )
  }

  const mainContent = (
    <>
      {conversation.ttsError && (
        <TTSErrorBanner type={conversation.ttsError.type} message={conversation.ttsError.message} />
      )}
      <Static items={conversation.completedEntries}>
        {(entry) => <CompletedEntry key={entry.id} entry={entry} assistantLabel={assistantLabel} />}
      </Static>
      {renderConversationLayout()}
    </>
  )

  const transcriptContent = (
    <TranscriptViewer
      entries={conversation.history}
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
