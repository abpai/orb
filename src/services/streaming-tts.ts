import { unlink } from 'node:fs/promises'
import { TTSError, type AppConfig } from '../types'
import {
  cleanTextForSpeech,
  createTempAudioPath,
  createStreamSession,
  detectPlayer,
  generateAudio,
  playAudio,
  stopSpeaking,
  wasPlaybackStopped,
  resetPlaybackStoppedFlag,
  DEFAULT_SERVER_URL,
  type StreamSession,
} from './tts'
import { createGatewayClient } from './gateway-client'

export interface StreamingSpeechCallbacks {
  onSpeakingStart?: () => void
  onSpeakingEnd?: () => void
  onError?: (error: TTSError) => void
}

export interface StreamingSpeechController {
  feedText(chunk: string): void
  finalize(): void
  stop(): void
  waitForCompletion(): Promise<void>
  isActive(): boolean
}

const STRONG_BOUNDARY = /[.!?]+["')\]]*(?:\s|$)/g
const SOFT_BOUNDARY = /[,;:](?:\s|$)/g

function findLastMatchIndex(text: string, re: RegExp): number {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  const pattern = new RegExp(re.source, flags)
  let lastIndex = -1

  while (pattern.exec(text) !== null) {
    lastIndex = pattern.lastIndex
  }

  return lastIndex
}

function findLastWhitespaceIndex(text: string): number {
  const lastSpace = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\t'), text.lastIndexOf('\n'))
  return lastSpace >= 0 ? lastSpace + 1 : -1
}

function extractStrongChunks(text: string): { chunks: string[]; consumed: number } {
  const chunks: string[] = []
  const pattern = new RegExp(STRONG_BOUNDARY.source, STRONG_BOUNDARY.flags)
  let lastIndex = 0

  while (pattern.exec(text) !== null) {
    const end = pattern.lastIndex
    const slice = text.slice(lastIndex, end)
    const trimmed = slice.trimEnd()
    if (trimmed.trim()) {
      chunks.push(trimmed)
    }
    lastIndex = end
  }

  return { chunks, consumed: lastIndex }
}

function extractChunkAtBoundary(
  text: string,
  boundary: number,
  minLength: number,
  forceFlush: boolean,
): { chunk: string | null; consumed: number } {
  if (boundary <= 0) return { chunk: null, consumed: 0 }

  const trimmed = text.slice(0, boundary).trimEnd()
  const hasContent = trimmed.trim().length > 0
  const meetsMinLength = forceFlush || minLength <= 0 || trimmed.trim().length >= minLength

  if (!hasContent || !meetsMinLength) {
    return { chunk: null, consumed: 0 }
  }

  return { chunk: trimmed, consumed: boundary }
}

export function createStreamingSpeechController(
  config: AppConfig,
  callbacks: StreamingSpeechCallbacks = {},
): StreamingSpeechController {
  let textBuffer = ''
  let processedOffset = 0
  let lastCleanedText = ''
  let finalized = false
  let stopped = false
  let speakingStarted = false
  let completed = false
  let lastFlushAt = Date.now()
  let maxWaitTimeout: ReturnType<typeof setTimeout> | null = null
  let graceTimeout: ReturnType<typeof setTimeout> | null = null
  let pendingGrace = false

  const sentenceQueue: string[] = []
  const client =
    config.ttsMode === 'serve'
      ? createGatewayClient(config.ttsServerUrl ?? DEFAULT_SERVER_URL)
      : null

  let isProcessing = false
  let currentSession: StreamSession | null = null
  let activeAbort: AbortController | null = null
  let prefetchAbort: AbortController | null = null
  let prefetchedStream: ReadableStream<Uint8Array> | null = null
  let completionResolve: (() => void) | null = null
  let completionReject: ((error: TTSError) => void) | null = null
  let completionPromise: Promise<void> | null = null
  let fatalError: TTSError | null = null

  function clearTimers(): void {
    if (maxWaitTimeout) {
      clearTimeout(maxWaitTimeout)
      maxWaitTimeout = null
    }
    if (graceTimeout) {
      clearTimeout(graceTimeout)
      graceTimeout = null
    }
    pendingGrace = false
  }

  function enqueueChunk(chunk: string, now: number): void {
    if (!chunk.trim()) return
    sentenceQueue.push(chunk)
    lastFlushAt = now
  }

  function reconcileProcessedOffset(cleanedText: string): void {
    if (!lastCleanedText) {
      lastCleanedText = cleanedText
      processedOffset = Math.min(processedOffset, cleanedText.length)
      return
    }

    if (cleanedText !== lastCleanedText) {
      const maxCheck = Math.min(processedOffset, cleanedText.length, lastCleanedText.length)
      let index = 0

      while (index < maxCheck && cleanedText[index] === lastCleanedText[index]) {
        index += 1
      }

      if (processedOffset > index) {
        processedOffset = index
      }
      lastCleanedText = cleanedText
    }

    if (processedOffset > cleanedText.length) {
      processedOffset = cleanedText.length
    }
  }

  function getPendingText(cleanedText: string): string {
    reconcileProcessedOffset(cleanedText)
    return cleanedText.slice(processedOffset)
  }

  function tryExtractAtBoundary(
    cleanedText: string,
    pending: string,
    boundary: number,
    minLength: number,
    forceFlush: boolean,
    now: number,
  ): string {
    const result = extractChunkAtBoundary(pending, boundary, minLength, forceFlush)
    if (result.consumed > 0) {
      if (result.chunk) enqueueChunk(result.chunk, now)
      processedOffset += result.consumed
      return getPendingText(cleanedText)
    }
    return pending
  }

  function extractChunksFromCleaned(
    cleanedText: string,
    options: { forceFlush: boolean; finalized: boolean; now: number },
  ): string {
    let pending = getPendingText(cleanedText)
    if (!pending.trim()) return pending

    const strong = extractStrongChunks(pending)
    if (strong.chunks.length > 0) {
      for (const chunk of strong.chunks) enqueueChunk(chunk, options.now)
      processedOffset += strong.consumed
      pending = getPendingText(cleanedText)
    }

    if (options.finalized) {
      if (pending.trim()) enqueueChunk(pending.trimEnd(), options.now)
      processedOffset = cleanedText.length
      return ''
    }

    if (!pending.trim()) return pending

    const { ttsMinChunkLength: minLength, ttsClauseBoundaries: allowClauses } = config

    if (allowClauses) {
      const softBoundary = findLastMatchIndex(pending, SOFT_BOUNDARY)
      pending = tryExtractAtBoundary(
        cleanedText,
        pending,
        softBoundary,
        minLength,
        options.forceFlush,
        options.now,
      )
    }

    if (!options.forceFlush || !pending.trim()) return pending

    const maxChunkLength = 200
    const wsBoundary = findLastWhitespaceIndex(pending)
    if (wsBoundary > 0) {
      pending = tryExtractAtBoundary(cleanedText, pending, wsBoundary, minLength, true, options.now)
    } else if (pending.length > 0) {
      // No whitespace boundary found - emit at max length or flush all if shorter
      const emitLength = Math.min(pending.length, maxChunkLength)
      enqueueChunk(pending.slice(0, emitLength), options.now)
      processedOffset += emitLength
      pending = pending.slice(emitLength)
    }

    return pending
  }

  function extractChunks(options: { forceFlush: boolean; finalized: boolean }): string {
    const cleanedText = cleanTextForSpeech(textBuffer)
    const now = Date.now()
    return extractChunksFromCleaned(cleanedText, { ...options, now })
  }

  function shouldGrace(pending: string): boolean {
    return /[\s.,!?;:]["')\]]?$/.test(pending)
  }

  function resetFlushTimers(pendingText: string): void {
    clearTimers()
    if (stopped || finalized) return
    if (config.ttsMaxWaitMs <= 0) return
    if (!pendingText.trim()) return

    const elapsed = Date.now() - lastFlushAt
    const delay = Math.max(config.ttsMaxWaitMs - elapsed, 0)
    maxWaitTimeout = setTimeout(handleMaxWait, delay)
  }

  function handleMaxWait(): void {
    if (stopped || finalized) return

    const cleanedText = cleanTextForSpeech(textBuffer)
    const pendingText = getPendingText(cleanedText)
    if (!pendingText.trim()) {
      return
    }

    if (config.ttsGraceWindowMs > 0 && shouldGrace(pendingText) && !pendingGrace) {
      pendingGrace = true
      graceTimeout = setTimeout(() => {
        pendingGrace = false
        const remaining = extractChunks({ forceFlush: true, finalized: false })
        maybeStartProcessing()
        resetFlushTimers(remaining)
      }, config.ttsGraceWindowMs)
      return
    }

    const lastFlush = lastFlushAt
    const remaining = extractChunksFromCleaned(cleanedText, {
      forceFlush: true,
      finalized: false,
      now: Date.now(),
    })
    if (remaining.trim() && lastFlushAt === lastFlush) {
      lastFlushAt = Date.now()
    }
    maybeStartProcessing()
    resetFlushTimers(remaining)
  }

  async function generateAndPlayViaFile(sentence: string): Promise<void> {
    const audioPath = createTempAudioPath(
      config.ttsMode,
      `tts-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    try {
      await generateAudio(sentence, config, audioPath)
      resetPlaybackStoppedFlag()
      await playAudio(audioPath, config.ttsSpeed)
      if (wasPlaybackStopped()) return
    } finally {
      await unlink(audioPath).catch(() => {})
    }
  }

  function cancelPrefetch(): void {
    prefetchAbort?.abort()
    prefetchAbort = null
    prefetchedStream?.cancel().catch(() => {})
    prefetchedStream = null
  }

  function startPrefetch(): void {
    if (!client || prefetchAbort || stopped || sentenceQueue.length === 0) return

    const nextSentence = sentenceQueue[0]!
    const abort = new AbortController()
    prefetchAbort = abort
    client
      .speakStream(nextSentence, config.ttsVoice, abort.signal)
      .then((stream) => {
        if (stopped || prefetchAbort !== abort) {
          // stop() or cancelPrefetch() fired while fetch was in-flight
          stream.cancel().catch(() => {})
        } else {
          prefetchedStream = stream
        }
      })
      .catch(() => {
        // Prefetch failure is non-fatal; will retry in processNextSentence
        if (prefetchAbort === abort) prefetchAbort = null
      })
  }

  async function streamOrFallback(sentence: string): Promise<void> {
    // Fall back to speakSync + afplay when no stream-capable player is installed
    try {
      detectPlayer()
    } catch (err) {
      if (err instanceof TTSError && err.type === 'player_not_found') {
        await generateAndPlayViaFile(sentence)
        return
      }
      throw err
    }

    let audioStream: ReadableStream<Uint8Array>
    if (prefetchedStream) {
      audioStream = prefetchedStream
      activeAbort = prefetchAbort
      prefetchedStream = null
      prefetchAbort = null
    } else {
      activeAbort = new AbortController()
      audioStream = await client!.speakStream(sentence, config.ttsVoice, activeAbort.signal)
    }

    const session = createStreamSession(audioStream, config.ttsSpeed)
    currentSession = session

    // Pre-fetch next sentence's audio while this one plays
    startPrefetch()

    await session.done
  }

  async function processNextSentence(): Promise<void> {
    if (isProcessing || stopped) return

    const sentence = sentenceQueue.shift()
    if (!sentence) {
      checkCompletion()
      return
    }

    isProcessing = true

    if (!speakingStarted) {
      speakingStarted = true
      callbacks.onSpeakingStart?.()
    }

    try {
      if (config.ttsMode === 'generate') {
        await generateAndPlayViaFile(sentence)
      } else {
        await streamOrFallback(sentence)
      }
    } catch (err) {
      if (stopped) return
      const ttsError =
        err instanceof TTSError ? err : new TTSError(String(err), 'generation_failed')
      callbacks.onError?.(ttsError)
      fail(ttsError)
      return
    } finally {
      currentSession = null
      activeAbort = null
      isProcessing = false
      if (!stopped) {
        processNextSentence()
      }
    }
  }

  function hasWorkRemaining(): boolean {
    return isProcessing || sentenceQueue.length > 0
  }

  function markComplete(): void {
    if (completed) return
    completed = true
    if (speakingStarted) callbacks.onSpeakingEnd?.()
    completionResolve?.()
  }

  function fail(error: TTSError): void {
    if (completed) return
    fatalError = error
    stopped = true
    completed = true
    sentenceQueue.length = 0
    cancelPrefetch()
    completionReject?.(error)
  }

  function checkCompletion(): void {
    if (finalized && !stopped && !hasWorkRemaining() && !completed) {
      markComplete()
    }
  }

  function maybeStartProcessing(): void {
    if (stopped || isProcessing) return
    if (sentenceQueue.length >= config.ttsBufferSentences || finalized) {
      processNextSentence()
    }
  }

  return {
    feedText(chunk: string): void {
      if (stopped || !config.ttsEnabled) return
      textBuffer += chunk
      const remaining = extractChunks({ forceFlush: false, finalized: false })
      maybeStartProcessing()
      resetFlushTimers(remaining)
    },

    finalize(): void {
      if (stopped || finalized) return
      finalized = true
      clearTimers()

      if (!config.ttsEnabled) {
        completionResolve?.()
        return
      }

      // Extract any remaining chunks
      extractChunks({ forceFlush: true, finalized: true })
      processNextSentence()
      checkCompletion()
    },

    stop(): void {
      stopped = true
      completed = true
      clearTimers()
      sentenceQueue.length = 0

      cancelPrefetch()

      activeAbort?.abort()
      activeAbort = null

      currentSession?.kill()
      currentSession = null

      // Stop generate-mode playback (afplay)
      stopSpeaking()

      // Resolve completion promise
      completionResolve?.()
    },

    waitForCompletion(): Promise<void> {
      if (completionPromise) return completionPromise

      completionPromise = new Promise((resolve, reject) => {
        completionResolve = resolve
        completionReject = reject

        if (fatalError) {
          reject(fatalError)
          return
        }

        const alreadyDone = stopped || completed || !config.ttsEnabled
        const justFinished = finalized && !hasWorkRemaining()

        if (alreadyDone || justFinished) {
          markComplete()
          resolve()
        }
      })

      return completionPromise
    },

    isActive(): boolean {
      return !stopped && (hasWorkRemaining() || speakingStarted)
    },
  }
}
