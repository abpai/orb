import { tmpdir } from 'os'
import { join } from 'path'
import { unlink } from 'fs/promises'
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

  const slice = text.slice(0, boundary)
  const trimmed = slice.trimEnd()
  const length = trimmed.trim().length

  if (!forceFlush && minLength > 0 && length < minLength) {
    return { chunk: null, consumed: 0 }
  }

  return { chunk: length > 0 ? trimmed : null, consumed: boundary }
}

export function createStreamingSpeechController(
  config: AppConfig,
  callbacks: StreamingSpeechCallbacks = {},
): StreamingSpeechController {
  let textBuffer = ''
  let processedOffset = 0
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
  let completionResolve: (() => void) | null = null
  let completionPromise: Promise<void> | null = null

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

  function getPendingText(cleanedText: string): string {
    if (processedOffset > cleanedText.length) {
      processedOffset = cleanedText.length
    }
    return cleanedText.slice(processedOffset)
  }

  function extractChunksFromCleaned(
    cleanedText: string,
    options: { forceFlush: boolean; finalized: boolean; now: number },
  ): string {
    let pending = getPendingText(cleanedText)
    if (!pending.trim()) {
      return pending
    }

    const strong = extractStrongChunks(pending)
    if (strong.chunks.length > 0) {
      for (const chunk of strong.chunks) {
        enqueueChunk(chunk, options.now)
      }
      processedOffset += strong.consumed
      pending = getPendingText(cleanedText)
    }

    if (options.finalized) {
      const remaining = pending.trim()
      if (remaining) {
        enqueueChunk(pending.trimEnd(), options.now)
      }
      processedOffset = cleanedText.length
      return ''
    }

    if (!pending.trim()) {
      return pending
    }

    const minLength = config.ttsMinChunkLength
    const allowClauses = config.ttsClauseBoundaries
    const forceFlush = options.forceFlush

    if (allowClauses) {
      const softBoundary = findLastMatchIndex(pending, SOFT_BOUNDARY)
      const soft = extractChunkAtBoundary(pending, softBoundary, minLength, forceFlush)
      if (soft.consumed > 0) {
        if (soft.chunk) {
          enqueueChunk(soft.chunk, options.now)
        }
        processedOffset += soft.consumed
        pending = getPendingText(cleanedText)
      }
    }

    if (!forceFlush || !pending.trim()) {
      return pending
    }

    const wsBoundary = findLastWhitespaceIndex(pending)
    const whitespace = extractChunkAtBoundary(pending, wsBoundary, minLength, true)
    if (whitespace.consumed > 0) {
      if (whitespace.chunk) {
        enqueueChunk(whitespace.chunk, options.now)
      }
      processedOffset += whitespace.consumed
      pending = getPendingText(cleanedText)
    }

    if (pending.trim()) {
      enqueueChunk(pending.trimEnd(), options.now)
      processedOffset = cleanedText.length
      return ''
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

    const remaining = extractChunksFromCleaned(cleanedText, {
      forceFlush: true,
      finalized: false,
      now: Date.now(),
    })
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
    const audioPath = join(
      tmpdir(),
      `tts-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
    )

    try {
      await generateAudio(sentence, config, audioPath)
      if (!stopped) {
        audioQueue.push({ path: audioPath, sentence })
        processPlaybackQueue()
      } else {
        // Cleanup if stopped during generation
        try {
          await unlink(audioPath)
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (err) {
      const ttsError =
        err instanceof TTSError ? err : new TTSError(String(err), 'generation_failed')
      if (ttsError.type === 'command_not_found') {
        stopped = true
      }
      callbacks.onError?.(ttsError)
    } finally {
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
      }
    } finally {
      // Cleanup audio file
      try {
        await unlink(audio.path)
      } catch {
        // Ignore cleanup errors
      }

      isPlaying = false
      if (!stopped) {
        processPlaybackQueue()
      }
    }
  }

  function hasWorkRemaining(): boolean {
    return isGenerating || isPlaying || sentenceQueue.length > 0 || audioQueue.length > 0
  }

  function checkCompletion(): void {
    if (!finalized || stopped || hasWorkRemaining() || completed) return

    completed = true
    if (speakingStarted) {
      callbacks.onSpeakingEnd?.()
    }
    completionResolve?.()
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

      // Clear audio queue and cleanup files
      for (const audio of audioQueue) {
        unlink(audio.path).catch(() => {})
      }
      audioQueue.length = 0

      // Stop current playback
      stopSpeaking()

      // Resolve completion promise
      completionResolve?.()
    },

    waitForCompletion(): Promise<void> {
      if (completionPromise) {
        return completionPromise
      }

      completionPromise = new Promise((resolve) => {
        completionResolve = resolve

        if (stopped || completed || !config.ttsEnabled) {
          resolve()
          return
        }

        if (finalized && !hasWorkRemaining()) {
          completed = true
          if (speakingStarted) {
            callbacks.onSpeakingEnd?.()
          }
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
