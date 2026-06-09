# #2 — Introduce TtsRun / SpeechPlaybackController abstraction

**Severity:** High (structural)
**Status:** Deferred — currently working; address after TTS test coverage improves

## Problem

TTS lifecycle is coordinated across four layers via hidden mutable state instead
of one explicit object:

1. `createTTSProcessor` hands a `TTSCompletionHandle` to `PipelineTask` through a
   callback side channel (`setCompletion`) — `src/pipeline/processors/tts.ts:43-70`.
2. `PipelineTask` awaits that handle separately after the frame pipeline ends —
   `src/pipeline/task.ts:191-211`.
3. `repeatTts()` constructs its own inline handle duplicating the normal path —
   `src/pipeline/task.ts:244-279`.
4. The streaming controller reaches back into `tts.ts` globals
   (`pauseSpeaking`, `stopSpeaking`, …) — `src/services/streaming-tts.ts:3-14`.
5. Module-level playback state lives in `src/services/tts.ts:132-136`.

The duplication between `run()` and `repeatTts()` means error handling is done
twice (`TTSError` casts at `task.ts:199-204` and `task.ts:264-269`). Pause,
resume, stop, and error behaviour are therefore hard to prove locally.

## Evidence

| File                             | Lines   | What it does                                         |
| -------------------------------- | ------- | ---------------------------------------------------- |
| `src/pipeline/processors/tts.ts` | 43-70   | buffers `pendingTTSFrames`, sets handle via callback |
| `src/pipeline/processors/tts.ts` | 86-112  | finalizes and hands off controller state             |
| `src/pipeline/task.ts`           | 139-144 | receives handle from processor callback              |
| `src/pipeline/task.ts`           | 191-211 | post-pipeline TTS await                              |
| `src/pipeline/task.ts`           | 244-279 | repeat-speech path, duplicate handle construction    |
| `src/services/streaming-tts.ts`  | 3-14    | imports global playback primitives                   |
| `src/services/tts.ts`            | 132-136 | module-level `currentPlayback` state                 |

## Remediation direction

Introduce a single `TtsRun` (or `SpeechPlaybackController`) class that owns:

- completion promise
- pause / resume / stop
- error emission

Both the normal answer path and `repeatTts` should instantiate the same
`TtsRun`; the task just `await`s `run.completion` and forwards errors. This
removes the duplicate error-cast blocks and makes the lifecycle a single
inspectable object rather than a set of coordinated closures.

**Pre-condition:** expand streaming-tts and tts unit-test coverage first so
structural changes are caught by the suite. See also `03-streaming-tts-split.md`.
