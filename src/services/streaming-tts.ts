import { unlink } from 'node:fs/promises'
import { TTSError, type AppConfig } from '../types'
import {
  createTempAudioPath,
  createPlaybackSink,
  createStreamSession,
  generateAudio,
  pauseSpeaking,
  playAudio,
  resumeSpeaking,
  stopSpeaking,
  resetPlaybackStoppedFlag,
  type PlaybackSink,
  type StreamSession,
} from './tts'
import { detectPlayer, type StreamAudioFormat } from './audio-player'
import { cleanTextForSpeech } from '../ui/utils/markdown'
import { createGatewayClient, DEFAULT_SERVER_URL, type GatewayStreamResult } from './gateway-client'
import { hasOpenCodeDelimiter } from './speech-text'
import {
  SOFT_BOUNDARY,
  extractChunkAtBoundary,
  extractStrongChunks,
  findLastMatchIndex,
  findLastWhitespaceIndex,
} from './speech-chunker'

interface StreamingSpeechCallbacks {
  onSpeakingStart?: () => void
  onSpeakingEnd?: () => void
  onError?: (error: TTSError) => void
}

interface PrefetchState {
  text: string
  abort: AbortController
  stream: Promise<GatewayStreamResult>
}

interface ActivePlaybackSink {
  sink: PlaybackSink
  format: StreamAudioFormat
  speed: number
}

export interface StreamingSpeechController {
  feedText(chunk: string): void
  finalize(): void
  stop(): void
  pause(): void
  resume(): void
  waitForCompletion(): Promise<void>
  isActive(): boolean
}

export function createStreamingSpeechController(
  config: AppConfig,
  callbacks: StreamingSpeechCallbacks = {},
): StreamingSpeechController {
  /**
   * Raw input accumulation and the cleaned-prefix bookkeeping that decides what
   * has already been spoken. Invariant: `processedOffset` indexes into the
   * *cleaned* text (cleanTextForSpeech(textBuffer)), and `lastCleanedText` is
   * the cleaned text observed on the previous delta — reconcileProcessedOffset
   * prefix-diffs against it to walk `processedOffset` back when an in-flight
   * edit rewrote already-counted characters. Compaction can reset all three to
   * empty once the settled prefix is fully emitted.
   */
  const textIntake = {
    textBuffer: '',
    processedOffset: 0,
    lastCleanedText: '',
  }

  /**
   * Debounce/grace timers that decide WHEN buffered text is force-flushed.
   * Invariant: at most one `maxWaitTimeout` and one `graceTimeout` are live at a
   * time; `pendingGrace` is true exactly while a grace timer is armed.
   * `lastFlushAt` is the wall-clock of the last enqueue/flush, used to compute
   * the remaining max-wait delay. clearTimers() must zero all four together.
   */
  const flushScheduling = {
    lastFlushAt: Date.now(),
    maxWaitTimeout: null as ReturnType<typeof setTimeout> | null,
    graceTimeout: null as ReturnType<typeof setTimeout> | null,
    pendingGrace: false,
  }

  const sentenceQueue: string[] = []

  // Lazily built so a malformed ttsServerUrl surfaces during playback (inside
  // processNextSentence's try/catch, routed through the completion handle) rather
  // than throwing synchronously at controller construction and aborting the whole
  // agent turn. Serve mode only; null in generate mode.
  let gatewayClient: ReturnType<typeof createGatewayClient> | null = null
  const getClient = (): ReturnType<typeof createGatewayClient> | null => {
    if (config.ttsMode !== 'serve') return null
    gatewayClient ??= createGatewayClient(config.ttsServerUrl ?? DEFAULT_SERVER_URL)
    return gatewayClient
  }

  /**
   * The currently-playing audio attempt and its cancellation handles.
   * Invariant: `isProcessing` is true exactly while processNextSentence is
   * mid-flight; `currentSession`/`activeAbort` are non-null only during an
   * in-flight stream and are cleared in the processing `finally`. `prefetch`
   * holds the speculatively-fetched next stream, owned solely here. `sink`
   * is the long-lived PCM playback process kept open until the finalized
   * queue drains.
   */
  const playback = {
    isProcessing: false,
    currentSession: null as StreamSession | null,
    sink: null as ActivePlaybackSink | null,
    activeAbort: null as AbortController | null,
    prefetch: null as PrefetchState | null,
  }

  /**
   * One-way lifecycle flags plus the completion-promise wiring. Invariant: once
   * `stopped` or `completed` is set it never clears; `finalized` flips once when
   * input ends; `fatalError` (if set) is the rejection delivered to
   * waitForCompletion. The completion resolve/reject are captured lazily when a
   * caller first awaits waitForCompletion.
   */
  const lifecycle = {
    finalized: false,
    stopped: false,
    paused: false,
    speakingStarted: false,
    completed: false,
    fatalError: null as TTSError | null,
    completionResolve: null as (() => void) | null,
    completionReject: null as ((error: TTSError) => void) | null,
    completionPromise: null as Promise<void> | null,
  }

  function clearTimers(): void {
    if (flushScheduling.maxWaitTimeout) {
      clearTimeout(flushScheduling.maxWaitTimeout)
      flushScheduling.maxWaitTimeout = null
    }
    if (flushScheduling.graceTimeout) {
      clearTimeout(flushScheduling.graceTimeout)
      flushScheduling.graceTimeout = null
    }
    flushScheduling.pendingGrace = false
  }

  function enqueueChunk(chunk: string, now: number): void {
    if (!chunk.trim()) return
    sentenceQueue.push(chunk)
    flushScheduling.lastFlushAt = now
  }

  function reconcileProcessedOffset(cleanedText: string): void {
    if (!textIntake.lastCleanedText) {
      textIntake.lastCleanedText = cleanedText
      textIntake.processedOffset = Math.min(textIntake.processedOffset, cleanedText.length)
      return
    }

    if (cleanedText !== textIntake.lastCleanedText) {
      const maxCheck = Math.min(
        textIntake.processedOffset,
        cleanedText.length,
        textIntake.lastCleanedText.length,
      )
      let index = 0

      while (index < maxCheck && cleanedText[index] === textIntake.lastCleanedText[index]) {
        index += 1
      }

      if (textIntake.processedOffset > index) {
        textIntake.processedOffset = index
      }
      textIntake.lastCleanedText = cleanedText
    }

    if (textIntake.processedOffset > cleanedText.length) {
      textIntake.processedOffset = cleanedText.length
    }
  }

  function getPendingText(cleanedText: string): string {
    reconcileProcessedOffset(cleanedText)
    return cleanedText.slice(textIntake.processedOffset)
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
      textIntake.processedOffset += result.consumed
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
      textIntake.processedOffset += strong.consumed
      pending = getPendingText(cleanedText)
    }

    if (options.finalized) {
      if (pending.trim()) enqueueChunk(pending.trimEnd(), options.now)
      textIntake.processedOffset = cleanedText.length
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
      textIntake.processedOffset += emitLength
      pending = pending.slice(emitLength)
    }

    return pending
  }

  function extractChunks(options: { forceFlush: boolean; finalized: boolean }): string {
    const cleanedText = cleanTextForSpeech(textIntake.textBuffer)
    const now = Date.now()
    return extractChunksFromCleaned(cleanedText, { ...options, now })
  }

  /**
   * Drop the buffer once everything cleaned has been emitted and no code
   * delimiter is left open. At that point the prefix is fully settled — its
   * cleaning can no longer change — so re-cleaning it on every future delta is
   * pure waste. Resetting keeps cleanTextForSpeech() O(unspoken tail) instead
   * of O(whole response), avoiding quadratic cost on long answers. The spoken
   * chunk sequence is unchanged (a leading space may drop from the next chunk,
   * which TTS renders identically).
   */
  function compactSettledBuffer(): void {
    if (textIntake.lastCleanedText.length === 0) return
    if (textIntake.processedOffset < textIntake.lastCleanedText.length) return
    if (hasOpenCodeDelimiter(textIntake.textBuffer)) return
    textIntake.textBuffer = ''
    textIntake.processedOffset = 0
    textIntake.lastCleanedText = ''
  }

  function shouldGrace(pending: string): boolean {
    return /[\s.,!?;:]["')\]]?$/.test(pending)
  }

  function resetFlushTimers(pendingText: string): void {
    clearTimers()
    if (lifecycle.stopped || lifecycle.finalized) return
    if (config.ttsMaxWaitMs <= 0) return
    if (!pendingText.trim()) return

    const elapsed = Date.now() - flushScheduling.lastFlushAt
    const delay = Math.max(config.ttsMaxWaitMs - elapsed, 0)
    flushScheduling.maxWaitTimeout = setTimeout(handleMaxWait, delay)
  }

  function handleMaxWait(): void {
    if (lifecycle.stopped || lifecycle.finalized) return

    const cleanedText = cleanTextForSpeech(textIntake.textBuffer)
    const pendingText = getPendingText(cleanedText)
    if (!pendingText.trim()) {
      return
    }

    if (config.ttsGraceWindowMs > 0 && shouldGrace(pendingText) && !flushScheduling.pendingGrace) {
      flushScheduling.pendingGrace = true
      flushScheduling.graceTimeout = setTimeout(() => {
        flushScheduling.pendingGrace = false
        const remaining = extractChunks({ forceFlush: true, finalized: false })
        maybeStartProcessing()
        resetFlushTimers(remaining)
        compactSettledBuffer()
      }, config.ttsGraceWindowMs)
      return
    }

    const lastFlush = flushScheduling.lastFlushAt
    const remaining = extractChunksFromCleaned(cleanedText, {
      forceFlush: true,
      finalized: false,
      now: Date.now(),
    })
    if (remaining.trim() && flushScheduling.lastFlushAt === lastFlush) {
      flushScheduling.lastFlushAt = Date.now()
    }
    maybeStartProcessing()
    resetFlushTimers(remaining)
    compactSettledBuffer()
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
    } finally {
      await unlink(audioPath).catch(() => {})
    }
  }

  function cancelPrefetch(): void {
    const state = playback.prefetch
    playback.prefetch = null
    state?.abort.abort()
    state?.stream
      .then((streamResult) => streamResult.stream.cancel().catch(() => {}))
      .catch(() => {})
  }

  function takeSpeechBatch(): string | null {
    if (sentenceQueue.length === 0) return null
    const targetCount = Math.max(1, config.ttsBufferSentences)

    const batchSize = Math.min(sentenceQueue.length, targetCount)
    return sentenceQueue.splice(0, batchSize).join(' ')
  }

  function normalizeStreamFormat(format: GatewayStreamResult['format']): StreamAudioFormat {
    if (format.kind === 'encoded') return { kind: 'encoded' }
    return {
      kind: 'raw-pcm',
      sampleRate: format.sampleRate,
      channels: format.channels,
      sampleWidth: format.sampleWidth,
      pcmFormat: format.pcmFormat,
    }
  }

  function streamFormatsEqual(left: StreamAudioFormat, right: StreamAudioFormat): boolean {
    if (left.kind !== right.kind) return false
    if (left.kind === 'encoded' || right.kind === 'encoded') return true
    return (
      left.sampleRate === right.sampleRate &&
      left.channels === right.channels &&
      left.sampleWidth === right.sampleWidth &&
      left.pcmFormat === right.pcmFormat
    )
  }

  function playbackSpeedFor(result: GatewayStreamResult): number {
    const applied = result.speedApplied
    if (applied === null || !Number.isFinite(applied) || applied <= 0) return config.ttsSpeed
    // The gateway already time-scaled the audio by `applied` (it may clamp the
    // requested speed, e.g. to [0.5, 2.0]); the player only makes up the
    // difference. Applying the full requested speed here would compound them.
    const residual = config.ttsSpeed / applied
    return Math.abs(residual - 1) <= 0.01 ? 1 : residual
  }

  async function finishPlaybackSink(): Promise<void> {
    const activeSink = playback.sink
    if (!activeSink) return
    playback.sink = null
    await activeSink.sink.finish()
  }

  function startPrefetch(): void {
    const client = getClient()
    if (!client || playback.prefetch || lifecycle.stopped || sentenceQueue.length === 0) return

    const nextSentence = takeSpeechBatch()
    if (!nextSentence) return

    const abort = new AbortController()
    const state: PrefetchState = {
      text: nextSentence,
      abort,
      stream: Promise.resolve(null as unknown as GatewayStreamResult),
    }

    state.stream = client
      .speakStream(nextSentence, config.ttsVoice, abort.signal, config.ttsSpeed)
      .then((streamResult) => {
        if (lifecycle.stopped) {
          streamResult.stream.cancel().catch(() => {})
          throw new TTSError('Prefetch canceled', 'generation_failed')
        }
        return streamResult
      })
    playback.prefetch = state
    state.stream.catch(() => {})
  }

  async function fetchSpeechStream(sentence: string): Promise<GatewayStreamResult> {
    const state = playback.prefetch
    if (state) {
      playback.prefetch = null
      if (state.text === sentence) {
        playback.activeAbort = state.abort
        try {
          return await state.stream
        } catch (err) {
          if (lifecycle.stopped) throw err
          playback.activeAbort = null
        }
      } else {
        state.abort.abort()
        state.stream
          .then((streamResult) => streamResult.stream.cancel().catch(() => {}))
          .catch(() => {})
      }
    }

    playback.activeAbort = new AbortController()
    return await getClient()!.speakStream(
      sentence,
      config.ttsVoice,
      playback.activeAbort.signal,
      config.ttsSpeed,
    )
  }

  async function playStreamResult(streamResult: GatewayStreamResult): Promise<void> {
    const speed = playbackSpeedFor(streamResult)

    if (streamResult.format.kind !== 'raw-pcm') {
      await finishPlaybackSink()
      const session = createStreamSession(
        streamResult.stream,
        speed,
        undefined,
        streamResult.format,
      )
      playback.currentSession = session
      await session.done
      return
    }

    const format = normalizeStreamFormat(streamResult.format)
    const activeSink = playback.sink
    if (
      !activeSink ||
      !streamFormatsEqual(activeSink.format, format) ||
      activeSink.speed !== speed
    ) {
      await finishPlaybackSink()
      playback.sink = {
        sink: createPlaybackSink(speed, format),
        format,
        speed,
      }
    }

    const currentSink = playback.sink
    if (!currentSink) {
      throw new TTSError('Playback sink failed to start', 'audio_playback')
    }
    await currentSink.sink.writeStream(streamResult.stream)
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

    const audioStream = await fetchSpeechStream(sentence)

    // Pre-fetch next sentence's audio while this one plays
    startPrefetch()

    await playStreamResult(audioStream)
  }

  async function processNextSentence(): Promise<void> {
    if (playback.isProcessing || lifecycle.stopped || lifecycle.paused) return

    const sentence = playback.prefetch?.text ?? takeSpeechBatch()
    if (!sentence) {
      if (lifecycle.finalized && playback.sink) {
        playback.isProcessing = true
        try {
          await finishPlaybackSink()
        } catch (err) {
          if (lifecycle.stopped) return
          const ttsError =
            err instanceof TTSError ? err : new TTSError(String(err), 'audio_playback')
          callbacks.onError?.(ttsError)
          fail(ttsError)
          return
        } finally {
          playback.isProcessing = false
        }
      }
      checkCompletion()
      return
    }

    playback.isProcessing = true

    if (!lifecycle.speakingStarted) {
      lifecycle.speakingStarted = true
      callbacks.onSpeakingStart?.()
    }

    try {
      // Generate mode always renders to a file. Serve mode streams only when
      // streaming is enabled; with --no-streaming-tts it stays on the batch
      // /v1/speech endpoint (speakSync + afplay) so gateways that lack the
      // streaming endpoint keep working.
      if (config.ttsMode === 'generate' || !config.ttsStreamingEnabled) {
        await generateAndPlayViaFile(sentence)
      } else {
        await streamOrFallback(sentence)
      }
    } catch (err) {
      if (lifecycle.stopped) return
      const ttsError =
        err instanceof TTSError ? err : new TTSError(String(err), 'generation_failed')
      callbacks.onError?.(ttsError)
      fail(ttsError)
      return
    } finally {
      playback.currentSession = null
      playback.activeAbort = null
      playback.isProcessing = false
      if (!lifecycle.stopped) {
        processNextSentence()
      }
    }
  }

  function hasWorkRemaining(): boolean {
    return (
      playback.isProcessing ||
      sentenceQueue.length > 0 ||
      Boolean(playback.prefetch || playback.sink)
    )
  }

  function markComplete(): void {
    if (lifecycle.completed) return
    lifecycle.completed = true
    if (lifecycle.speakingStarted) callbacks.onSpeakingEnd?.()
    lifecycle.completionResolve?.()
  }

  function fail(error: TTSError): void {
    if (lifecycle.completed) return
    lifecycle.fatalError = error
    lifecycle.stopped = true
    lifecycle.completed = true
    sentenceQueue.length = 0
    cancelPrefetch()
    playback.sink?.sink.kill()
    playback.sink = null
    lifecycle.completionReject?.(error)
  }

  function checkCompletion(): void {
    if (lifecycle.finalized && !lifecycle.stopped && !hasWorkRemaining() && !lifecycle.completed) {
      markComplete()
    }
  }

  function maybeStartProcessing(): void {
    if (lifecycle.stopped || playback.isProcessing || lifecycle.paused) return
    if (sentenceQueue.length > 0 || lifecycle.finalized) {
      processNextSentence()
    }
  }

  return {
    feedText(chunk: string): void {
      if (lifecycle.stopped || !config.ttsEnabled) return
      textIntake.textBuffer += chunk
      const remaining = extractChunks({ forceFlush: false, finalized: false })
      maybeStartProcessing()
      resetFlushTimers(remaining)
      compactSettledBuffer()
    },

    finalize(): void {
      if (lifecycle.stopped || lifecycle.finalized) return
      lifecycle.finalized = true
      clearTimers()

      if (!config.ttsEnabled) {
        lifecycle.completionResolve?.()
        return
      }

      // Extract any remaining chunks
      extractChunks({ forceFlush: true, finalized: true })
      processNextSentence()
      checkCompletion()
    },

    stop(): void {
      lifecycle.stopped = true
      lifecycle.paused = false
      lifecycle.completed = true
      clearTimers()
      sentenceQueue.length = 0

      cancelPrefetch()

      playback.activeAbort?.abort()
      playback.activeAbort = null

      playback.currentSession?.kill()
      playback.currentSession = null

      playback.sink?.sink.kill()
      playback.sink = null

      // Stop generate-mode playback (afplay)
      stopSpeaking()

      // Resolve completion promise
      lifecycle.completionResolve?.()
    },

    pause(): void {
      if (lifecycle.stopped || lifecycle.completed || lifecycle.paused) return
      lifecycle.paused = true
      playback.currentSession?.pause()
      playback.sink?.sink.pause()
      pauseSpeaking()
    },

    resume(): void {
      if (lifecycle.stopped || lifecycle.completed || !lifecycle.paused) return
      lifecycle.paused = false
      playback.currentSession?.resume()
      playback.sink?.sink.resume()
      resumeSpeaking()
      // Kick the queue back into motion if an audio session isn't already running
      if (!playback.currentSession && !playback.isProcessing) {
        processNextSentence()
      }
    },

    waitForCompletion(): Promise<void> {
      if (lifecycle.completionPromise) return lifecycle.completionPromise

      lifecycle.completionPromise = new Promise((resolve, reject) => {
        lifecycle.completionResolve = resolve
        lifecycle.completionReject = reject

        if (lifecycle.fatalError) {
          reject(lifecycle.fatalError)
          return
        }

        const alreadyDone = lifecycle.stopped || lifecycle.completed || !config.ttsEnabled
        const justFinished = lifecycle.finalized && !hasWorkRemaining()

        if (alreadyDone || justFinished) {
          markComplete()
          resolve()
        }
      })

      return lifecycle.completionPromise
    },

    isActive(): boolean {
      return !lifecycle.stopped && (hasWorkRemaining() || lifecycle.speakingStarted)
    },
  }
}

/**
 * Speak an already-complete string through a fresh streaming controller.
 *
 * Feeds the whole text in one shot and finalizes immediately, so there is no
 * separate "batch" playback path: the controller renders it through the same
 * machinery it uses for live deltas (streaming + prefetch when streaming is
 * enabled in serve mode, file-by-file otherwise), the only difference being
 * that nothing arrives incrementally. The returned controller exposes
 * waitForCompletion/stop/pause/resume for the caller to drive — used for
 * replays and non-streaming batch playback.
 */
export function speakText(text: string, config: AppConfig): StreamingSpeechController {
  const controller = createStreamingSpeechController(config)
  controller.feedText(text)
  controller.finalize()
  return controller
}
