# #3 — Split streaming-tts.ts into focused modules

**Severity:** High (structural)
**Status:** Deferred — currently working; address after TTS test coverage improves

## Problem

`src/services/streaming-tts.ts` is 604 lines of a single large mutable closure
that handles five distinct concerns simultaneously:

1. **Text chunking / reconciliation** — `STRONG_BOUNDARY`, `SOFT_BOUNDARY`,
   `extractStrongChunks`, `extractChunkAtBoundary`, `reconcileProcessedOffset`
   (lines 34-260)
2. **Flush timer / scheduler policy** — `maxWaitTimeout`, `graceTimeout`,
   `handleMaxWait`, `resetFlushTimers` (lines 291-335)
3. **Queue and buffer management** — `sentenceQueue`, `takeSpeechBatch`,
   `peekSpeechBatch`, `compactSettledBuffer` (lines 269-373)
4. **Prefetch and stream/file fallback** — `prefetchAbort`, `prefetchedStream`,
   `startPrefetch`, `streamOrFallback`, `generateAndPlayViaFile` (lines 351-435)
5. **Lifecycle state machine** — `stopped`, `paused`, `completed`, `fatalError`,
   `markComplete`, `fail`, `checkCompletion` (lines 476-508)

A reader must hold all 13+ mutable variables in mind simultaneously. Small
changes to one concern can silently break another.

## Evidence

| Lines   | Concern                                  |
| ------- | ---------------------------------------- |
| 115-142 | Large mutable local variable block       |
| 162-267 | Text reconciliation and chunk extraction |
| 269-285 | Buffer compaction                        |
| 291-335 | Flush timers and grace window            |
| 351-397 | Prefetch                                 |
| 399-435 | Stream/file fallback                     |
| 437-474 | Queue processing                         |
| 476-508 | Completion/error state                   |
| 510-603 | Public control surface                   |

## Remediation direction

Extract pure, independently-testable pieces:

- **`speech-chunker.ts`** — `extractStrongChunks`, `extractChunkAtBoundary`,
  `reconcileProcessedOffset`, boundary constants. Pure functions, no timers.
- **`speech-scheduler.ts`** — timer policy (maxWait, grace window). Takes a
  `flush` callback; owns only `setTimeout` handles.
- **`speech-queue.ts`** — `sentenceQueue`, `takeSpeechBatch`, `peekSpeechBatch`,
  `compactSettledBuffer`.
- **`speech-player.ts`** — prefetch slot, `streamOrFallback`,
  `generateAndPlayViaFile`. Implements a `SpeechPlayer` interface.
- **`streaming-tts.ts`** becomes a thin state machine (~80 lines) wiring the
  above together.

See also `02-tts-run-abstraction.md` for the higher-level lifecycle object that
will own this controller.
