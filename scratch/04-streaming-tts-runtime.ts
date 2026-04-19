/**
 * scratch/04-streaming-tts-runtime.ts — TTS Sidecar
 *
 * Shows how streaming TTS sits beside the main frame flow:
 * it consumes text progressively and manages its own timing state.
 *
 * ENTRY: src/services/streaming-tts.ts:89 createStreamingSpeechController()
 *
 * Run:
 *   bun run scratch/04-streaming-tts-runtime.ts
 */
import { mock } from 'bun:test'
import { cleanTextForSpeech } from '../src/ui/utils/markdown'
import type { AppConfig } from '../src/types'
import { DEFAULT_CONFIG } from '../src/types'

let startedAt = 0
let generatedChunks: Array<{ text: string; atMs: number }> = []
let playedFiles: Array<{ path: string; atMs: number }> = []
let playbackStopped = false

function nowMs(): number {
  return Math.round(performance.now() - startedAt)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

mock.module('../src/services/tts', () => ({
  cleanTextForSpeech,
  DEFAULT_SERVER_URL: 'http://localhost:8000',
  detectPlayer: () => ({ binary: 'mpv', buildArgs: () => [] }),
  resetDetectedPlayer() {},
  createStreamSession: () => ({
    done: Promise.resolve(),
    kill() {},
    get wasKilled() {
      return false
    },
  }),
  getTempAudioExtension: () => 'wav',
  createTempAudioPath: (_mode: string, name: string) => `/tmp/${name}.wav`,
  async generateAudio(text: string, _config: AppConfig, outputPath: string) {
    generatedChunks.push({ text, atMs: nowMs() })
    await Bun.write(outputPath, text)
  },
  async playAudio(path: string) {
    playedFiles.push({ path, atMs: nowMs() })
  },
  stopSpeaking() {
    playbackStopped = true
  },
  wasPlaybackStopped() {
    return playbackStopped
  },
  resetPlaybackStoppedFlag() {
    playbackStopped = false
  },
  async speak() {},
}))

const { createStreamingSpeechController } = await import('../src/services/streaming-tts')

async function runCase(
  label: string,
  overrides: Partial<AppConfig>,
  drive: (controller: ReturnType<typeof createStreamingSpeechController>) => Promise<void>,
): Promise<void> {
  generatedChunks = []
  playedFiles = []
  playbackStopped = false
  startedAt = performance.now()

  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    ttsEnabled: true,
    ttsStreamingEnabled: true,
    ttsMode: 'generate',
    ttsBufferSentences: 1,
    ...overrides,
  }

  const events: Array<{ label: string; atMs: number }> = []
  const controller = createStreamingSpeechController(config, {
    onSpeakingStart: () => events.push({ label: 'onSpeakingStart', atMs: nowMs() }),
    onSpeakingEnd: () => events.push({ label: 'onSpeakingEnd', atMs: nowMs() }),
    onError: (error) => events.push({ label: `onError:${error.type}`, atMs: nowMs() }),
  })

  await drive(controller)
  await controller.waitForCompletion()

  console.log(`\n${label}:`)
  console.log(
    `  config → buffer=${config.ttsBufferSentences}, min=${config.ttsMinChunkLength}, maxWait=${config.ttsMaxWaitMs}, grace=${config.ttsGraceWindowMs}, clauses=${config.ttsClauseBoundaries}`,
  )
  console.log(
    `  generated chunks → ${generatedChunks.length > 0 ? generatedChunks.map((chunk) => `${chunk.text.length}ch @${chunk.atMs}ms`).join(', ') : '(none)'}`,
  )
  console.log(
    `  chunk preview     → ${generatedChunks.length > 0 ? generatedChunks.map((chunk) => JSON.stringify(chunk.text)).join(', ') : '(none)'}`,
  )
  console.log(
    `  callbacks         → ${events.length > 0 ? events.map((event) => `${event.label}@${event.atMs}ms`).join(', ') : '(none)'}`,
  )
  console.log(`  playAudio calls    → ${playedFiles.length}`)
}

console.log('04 · TTS Sidecar\n')
console.log('Primitive:')
console.log('  text stream -> chunking/playback sidecar\n')

const markdownInput = `### Status

The **critical path** enters \`processQueue()\`.

\`\`\`ts
while (queue.length > 0) handle(queue.shift()!)
\`\`\`

Done.`

console.log('─── cleanTextForSpeech() ───\n')
console.log(`  raw     → ${JSON.stringify(markdownInput)}`)
console.log(`  cleaned → ${JSON.stringify(cleanTextForSpeech(markdownInput))}`)

await runCase(
  'Strong sentence boundaries',
  {
    ttsMinChunkLength: 1,
    ttsMaxWaitMs: 100,
    ttsGraceWindowMs: 0,
    ttsClauseBoundaries: false,
  },
  async (controller) => {
    controller.feedText('Hello world. ')
    controller.feedText('Second sentence! ')
    controller.finalize()
  },
)

await runCase(
  'Timeout flush with no punctuation',
  {
    ttsMinChunkLength: 10,
    ttsMaxWaitMs: 40,
    ttsGraceWindowMs: 0,
    ttsClauseBoundaries: false,
  },
  async (controller) => {
    controller.feedText(
      'This clause keeps going without sentence punctuation but it does have spaces',
    )
    await sleep(70)
    controller.finalize()
  },
)

await runCase(
  'Forced split for 250 chars with no whitespace',
  {
    ttsMinChunkLength: 1,
    ttsMaxWaitMs: 40,
    ttsGraceWindowMs: 0,
    ttsClauseBoundaries: false,
  },
  async (controller) => {
    controller.feedText('a'.repeat(250))
    await sleep(70)
    controller.finalize()
  },
)

await runCase(
  'No timer flush when ttsMaxWaitMs=0',
  {
    ttsMinChunkLength: 1,
    ttsMaxWaitMs: 0,
    ttsGraceWindowMs: 0,
    ttsClauseBoundaries: false,
  },
  async (controller) => {
    controller.feedText(
      'No timer flush should happen before finalize when max wait is disabled',
    )
    await sleep(70)
    console.log(`\nBefore finalize, generated chunk count = ${generatedChunks.length}`)
    controller.finalize()
  },
)

mock.restore()

console.log('\nTakeaway:')
console.log('  TTS is not the orchestrator.')
console.log('  It is a sidecar that turns completed or partial text into speech over time.')
