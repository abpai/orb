import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { TTSError, type AppConfig } from '../types'
import {
  cleanTextForSpeech,
  generateAudio,
  playAudio,
  stopSpeaking,
  wasPlaybackStopped,
  resetPlaybackStoppedFlag,
} from './tts'

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

interface QueuedAudio {
  path: string
  sentence: string
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
  const audioQueue: QueuedAudio[] = []

  let isGenerating = false
  let isPlaying = false
  let generationAbortController: AbortController | null = null
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

  async function cleanupAudioPath(path: string): Promise<void> {
    await unlink(path).catch(() => {})
  }

  function clearAudioQueue(): void {
    for (const audio of audioQueue) {
      void cleanupAudioPath(audio.path)
    }
    audioQueue.length = 0
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
        maybeStartGeneration()
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
    maybeStartGeneration()
    resetFlushTimers(remaining)
  }

  async function processGenerationQueue(): Promise<void> {
    if (isGenerating || stopped) return

    const sentence = sentenceQueue.shift()
    if (!sentence) {
      checkCompletion()
      return
    }

    isGenerating = true
    generationAbortController = new AbortController()
    const audioPath = join(
      tmpdir(),
      `tts-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${
        config.ttsMode === 'generate' ? 'aiff' : 'mp3'
      }`,
    )

    try {
      await generateAudio(sentence, config, audioPath, generationAbortController.signal)
      if (!stopped) {
        audioQueue.push({ path: audioPath, sentence })
        processPlaybackQueue()
      } else {
        await cleanupAudioPath(audioPath)
      }
    } catch (err) {
      const ttsError =
        err instanceof TTSError ? err : new TTSError(String(err), 'generation_failed')
      callbacks.onError?.(ttsError)
      fail(ttsError)
    } finally {
      generationAbortController = null
      isGenerating = false
      if (!stopped) {
        processGenerationQueue()
      }
    }
  }

  async function processPlaybackQueue(): Promise<void> {
    if (isPlaying || stopped) return

    const audio = audioQueue.shift()
    if (!audio) {
      checkCompletion()
      return
    }

    isPlaying = true
    resetPlaybackStoppedFlag()

    // Notify that speaking has started
    if (!speakingStarted) {
      speakingStarted = true
      callbacks.onSpeakingStart?.()
    }

    try {
      await playAudio(audio.path, config.ttsSpeed)
    } catch (err) {
      // Check if playback was stopped manually (not an error)
      if (!wasPlaybackStopped()) {
        const ttsError = err instanceof TTSError ? err : new TTSError(String(err), 'audio_playback')
        callbacks.onError?.(ttsError)
        fail(ttsError)
      }
    } finally {
      await cleanupAudioPath(audio.path)

      isPlaying = false
      if (!stopped) {
        processPlaybackQueue()
      }
    }
  }

  function hasWorkRemaining(): boolean {
    return isGenerating || isPlaying || sentenceQueue.length > 0 || audioQueue.length > 0
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
    clearAudioQueue()
    completionReject?.(error)
  }

  function checkCompletion(): void {
    if (finalized && !stopped && !hasWorkRemaining() && !completed) {
      markComplete()
    }
  }

  function maybeStartGeneration(): void {
    if (stopped || isGenerating) return
    if (sentenceQueue.length >= config.ttsBufferSentences || finalized) {
      processGenerationQueue()
    }
  }

  return {
    feedText(chunk: string): void {
      if (stopped || !config.ttsEnabled) return
      textBuffer += chunk
      const remaining = extractChunks({ forceFlush: false, finalized: false })
      maybeStartGeneration()
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
      processGenerationQueue()
      checkCompletion()
    },

    stop(): void {
      stopped = true
      completed = true
      clearTimers()
      sentenceQueue.length = 0

      clearAudioQueue()

      generationAbortController?.abort()
      generationAbortController = null

      // Stop current playback
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
