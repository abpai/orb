import React, { useCallback, useRef, useState } from 'react'
import { Box, useInput } from 'ink'

import { runAgent } from '../services/claude-agent'
import {
  createStreamingSpeechController,
  type StreamingSpeechController,
} from '../services/streaming-tts'
import { speak, stopSpeaking } from '../services/tts'
import { TTSError, type AppConfig, type AppState, type TTSErrorType, type ViewMode } from '../types'
import { ActiveMessagePanel } from './components/ActiveMessagePanel'
import { type HistoryEntry } from './components/ConversationPanel'
import { InputPrompt } from './components/InputPrompt'
import { ResonanceBar } from './components/ResonanceBar'
import { TranscriptViewer } from './components/TranscriptViewer'
import { TTSErrorBanner } from './components/TTSErrorBanner'
import { WelcomeSplash } from './components/WelcomeSplash'

interface AppProps {
  config: AppConfig
}

export function App({ config }: AppProps) {
  const [state, setState] = useState<AppState>('idle')
  const [viewMode, setViewMode] = useState<ViewMode>('main')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [ttsError, setTtsError] = useState<{ type: TTSErrorType; message: string } | null>(null)
  const sessionIdRef = useRef<string | undefined>(undefined)
  // Track accumulated streamed text (accessible outside React state closure)
  const streamedTextRef = useRef('')
  // Buffer streamed text to avoid re-rendering on every chunk
  const pendingTextRef = useRef('')
  const flushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Streaming speech controller ref for interrupt handling
  const speechControllerRef = useRef<StreamingSpeechController | null>(null)

  // Handle interrupt via Esc or Ctrl+S
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === 's')) {
        speechControllerRef.current?.stop()
        stopSpeaking()
        setState((prev) => (prev === 'processing_speaking' ? 'processing' : 'idle'))
      }
    },
    { isActive: state === 'processing_speaking' || state === 'speaking' },
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

  const updateEntry = useCallback(
    (entryId: string, updater: (entry: HistoryEntry) => HistoryEntry) => {
      setHistory((prev) => prev.map((entry) => (entry.id === entryId ? updater(entry) : entry)))
    },
    [],
  )

  const clearFlushTimeout = useCallback(() => {
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }
  }, [])

  const flushPendingText = useCallback(
    (entryId: string) => {
      if (!pendingTextRef.current) return
      const pending = pendingTextRef.current
      pendingTextRef.current = ''
      updateEntry(entryId, (entry) => ({ ...entry, answer: entry.answer + pending }))
    },
    [updateEntry],
  )

  const handleSubmit = useCallback(
    async (query: string) => {
      setState('processing')
      setTtsError(null)
      streamedTextRef.current = ''
      pendingTextRef.current = ''
      clearFlushTimeout()
      const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      setActiveEntryId(entryId)

      setHistory((prev) => [
        ...prev,
        { id: entryId, question: query, toolCalls: [], answer: '', error: null },
      ])

      let agentCompleted = false

      // Create streaming speech controller if streaming is enabled
      const useStreaming = config.ttsEnabled && config.ttsStreamingEnabled
      const controller = useStreaming
        ? createStreamingSpeechController(config, {
            onSpeakingStart: () => setState(agentCompleted ? 'speaking' : 'processing_speaking'),
            onError: (err) => setTtsError({ type: err.type, message: err.message }),
          })
        : null

      speechControllerRef.current = controller

      try {
        const result = await runAgent(query, config, sessionIdRef.current, {
          onSessionId: (id) => {
            sessionIdRef.current = id
          },
          onToolCall: (call) => {
            updateEntry(entryId, (entry) => ({
              ...entry,
              toolCalls: [...entry.toolCalls, call],
            }))
          },
          onToolResult: (index, result) => {
            updateEntry(entryId, (entry) => ({
              ...entry,
              toolCalls: entry.toolCalls.map((c) =>
                c.index === index ? { ...c, status: 'complete', result } : c,
              ),
            }))
          },
          onAssistantText: (text) => {
            streamedTextRef.current += text
            pendingTextRef.current += text
            // Feed text to streaming controller
            controller?.feedText(text)

            if (!flushTimeoutRef.current) {
              flushTimeoutRef.current = setTimeout(() => {
                flushTimeoutRef.current = null
                flushPendingText(entryId)
              }, 150)
            }
          },
        })

        agentCompleted = true
        clearFlushTimeout()
        flushPendingText(entryId)

        // Use result if available, otherwise use accumulated streamed text
        const textToSpeak = result || streamedTextRef.current
        if (result) {
          pendingTextRef.current = ''
          updateEntry(entryId, (entry) => ({ ...entry, answer: result }))
        }

        if (useStreaming && controller) {
          // Finalize streaming and wait for completion
          controller.finalize()
          // Transition to speaking state if controller is still active
          if (controller.isActive()) {
            setState('speaking')
          }
          await controller.waitForCompletion()
        } else {
          // Legacy: speak after agent completes
          setState('speaking')
          try {
            await speak(textToSpeak, config)
          } catch (ttsErr) {
            if (ttsErr instanceof TTSError) {
              setTtsError({ type: ttsErr.type, message: ttsErr.message })
            }
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        clearFlushTimeout()
        pendingTextRef.current = ''
        updateEntry(entryId, (entry) => ({
          ...entry,
          answer: `Error: ${errorMsg}`,
          error: errorMsg,
        }))
        // Stop streaming on error
        controller?.stop()
      } finally {
        speechControllerRef.current = null
        clearFlushTimeout()
        pendingTextRef.current = ''
        setState('idle')
      }
    },
    [clearFlushTimeout, config, flushPendingText, updateEntry],
  )

  const activeEntry = activeEntryId ? (history.find((e) => e.id === activeEntryId) ?? null) : null

  const mainContent = (
    <>
      {ttsError && <TTSErrorBanner type={ttsError.type} message={ttsError.message} />}
      {history.length === 0 ? <WelcomeSplash /> : <ActiveMessagePanel entry={activeEntry} />}
      <InputPrompt onSubmit={handleSubmit} disabled={state !== 'idle'} />
      <ResonanceBar status={state} hasHistory={history.length > 0} />
    </>
  )

  const transcriptContent = (
    <TranscriptViewer entries={history} onClose={() => setViewMode('main')} />
  )

  return (
    <Box flexDirection="column" padding={1}>
      {viewMode === 'transcript' ? transcriptContent : mainContent}
    </Box>
  )
}
