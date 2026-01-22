import { tmpdir } from 'os'
import { join } from 'path'
import { unlink } from 'fs/promises'
import { TTSError, type AppConfig } from '../types'
import {
  splitIntoSentences,
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

export function createStreamingSpeechController(
  config: AppConfig,
  callbacks: StreamingSpeechCallbacks = {},
): StreamingSpeechController {
  let textBuffer = ''
  let processedSentenceCount = 0
  let finalized = false
  let stopped = false
  let speakingStarted = false
  let completed = false

  const sentenceQueue: string[] = []
  const audioQueue: QueuedAudio[] = []

  let isGenerating = false
  let isPlaying = false
  let completionResolve: (() => void) | null = null
  let completionPromise: Promise<void> | null = null

  function extractNewSentences(): void {
    const cleanedText = cleanTextForSpeech(textBuffer)
    const allSentences = splitIntoSentences(cleanedText)

    // If not finalized, don't extract the last sentence (might be incomplete)
    const extractUpTo = finalized ? allSentences.length : Math.max(0, allSentences.length - 1)
    const startIndex = Math.max(0, Math.min(processedSentenceCount, extractUpTo))

    for (let i = startIndex; i < extractUpTo; i++) {
      const sentence = allSentences[i]
      if (sentence && sentence.trim()) {
        sentenceQueue.push(sentence)
      }
    }

    processedSentenceCount = extractUpTo
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
      await playAudio(audio.path)
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

  function isComplete(): boolean {
    return (
      finalized &&
      !stopped &&
      sentenceQueue.length === 0 &&
      audioQueue.length === 0 &&
      !isGenerating &&
      !isPlaying
    )
  }

  function checkCompletion(): void {
    if (!isComplete() || completed) return

    completed = true
    if (speakingStarted) {
      callbacks.onSpeakingEnd?.()
    }
    completionResolve?.()
  }

  function startProcessing(): void {
    // Start if we have enough buffered sentences
    const cleanedText = cleanTextForSpeech(textBuffer)
    const allSentences = splitIntoSentences(cleanedText)
    const completeSentences = finalized ? allSentences.length : Math.max(0, allSentences.length - 1)

    if (completeSentences >= config.ttsBufferSentences || finalized) {
      extractNewSentences()
      processGenerationQueue()
    }
  }

  return {
    feedText(chunk: string): void {
      if (stopped || !config.ttsEnabled) return
      textBuffer += chunk
      startProcessing()
    },

    finalize(): void {
      if (stopped || finalized) return
      finalized = true

      if (!config.ttsEnabled) {
        completionResolve?.()
        return
      }

      // Extract any remaining sentences
      extractNewSentences()
      processGenerationQueue()
      checkCompletion()
    },

    stop(): void {
      stopped = true
      completed = true
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
      if (!completionPromise) {
        completionPromise = new Promise((resolve) => {
          completionResolve = resolve

          // If already complete or stopped, resolve immediately
          if (stopped || completed || !config.ttsEnabled || isComplete()) {
            if (!completed && isComplete()) {
              completed = true
              if (speakingStarted) {
                callbacks.onSpeakingEnd?.()
              }
            }
            resolve()
          }
        })
      }
      return completionPromise
    },

    isActive(): boolean {
      return (
        !stopped &&
        (isPlaying ||
          audioQueue.length > 0 ||
          sentenceQueue.length > 0 ||
          isGenerating ||
          speakingStarted)
      )
    },
  }
}
