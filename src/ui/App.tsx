import React, { useState, useRef, useCallback } from 'react'
import { Box } from 'ink'
import { TTSError, type AppConfig, type AppState, type ToolCall, type TTSErrorType } from '../types'
import { runAgent } from '../services/claude-agent'
import { speak } from '../services/tts'
import { StatusBar } from './components/StatusBar'
import { ToolPanel } from './components/ToolPanel'
import { ResponsePanel } from './components/ResponsePanel'
import { InputField } from './components/InputField'
import { TTSErrorBanner } from './components/TTSErrorBanner'

interface AppProps {
  config: AppConfig
}

export function App({ config }: AppProps) {
  const [state, setState] = useState<AppState>('idle')
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [response, setResponse] = useState('')
  const [ttsError, setTtsError] = useState<{ type: TTSErrorType; message: string } | null>(null)
  const sessionIdRef = useRef<string | undefined>(undefined)
  // Track accumulated streamed text (accessible outside React state closure)
  const streamedTextRef = useRef('')

  const handleSubmit = useCallback(
    async (query: string) => {
      setState('processing')
      setToolCalls([])
      setResponse('')
      setTtsError(null)
      streamedTextRef.current = ''

      try {
        const result = await runAgent(query, config, sessionIdRef.current, {
          onSessionId: (id) => {
            sessionIdRef.current = id
          },
          onToolCall: (call) => {
            setToolCalls((prev) => [...prev, call])
          },
          onToolResult: (index, result) => {
            setToolCalls((prev) =>
              prev.map((c) => (c.index === index ? { ...c, status: 'complete', result } : c)),
            )
          },
          onAssistantText: (text) => {
            streamedTextRef.current += text
            setResponse((prev) => prev + text)
          },
        })

        // Use result if available, otherwise use accumulated streamed text
        const textToSpeak = result || streamedTextRef.current
        if (result) {
          setResponse(result)
        }

        setState('speaking')
        try {
          await speak(textToSpeak, config)
        } catch (ttsErr) {
          if (ttsErr instanceof TTSError) {
            setTtsError({ type: ttsErr.type, message: ttsErr.message })
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        setResponse(`Error: ${errorMsg}`)
      } finally {
        setState('idle')
      }
    },
    [config],
  )

  return (
    <Box flexDirection="column" padding={1}>
      <StatusBar status={state} sessionActive={Boolean(sessionIdRef.current)} />
      {ttsError && <TTSErrorBanner type={ttsError.type} message={ttsError.message} />}
      <ToolPanel calls={toolCalls} />
      <ResponsePanel text={response} />
      <InputField onSubmit={handleSubmit} disabled={state !== 'idle'} />
    </Box>
  )
}
