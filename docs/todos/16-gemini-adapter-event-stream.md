# #16 — Fix Gemini adapter's pending-frames side channel and type casts

**Severity:** Medium (structural)
**Status:** Deferred — tool status can lag but no user-visible data loss today

## Problem

The Gemini adapter in `src/pipeline/adapters/gemini.ts` buffers tool frames
through a callback side channel rather than the main event stream:

- `pendingFrames` array created at lines 37-40
- Tool start/result frames pushed by callback helpers at lines 41-60
- `onStepFinish` pushes into that buffer at lines 73-83
- Frames are drained only when text chunks arrive or after text streaming
  completes (lines 89-103)

If a long tool step produces no text chunks, tool-status UI frames are withheld
until text eventually arrives. The adapter also silences type errors with
`appConfig.llmModel as never` (line 62-63) and stream-args casts (lines 73-85),
indicating the model/provider type boundary is not explicit enough.

## Evidence

| Lines                                    | Concern                              |
| ---------------------------------------- | ------------------------------------ |
| `src/pipeline/adapters/gemini.ts:37-40`  | `pendingFrames` buffer creation      |
| `src/pipeline/adapters/gemini.ts:41-60`  | callback helpers pushing into buffer |
| `src/pipeline/adapters/gemini.ts:73-83`  | `onStepFinish` pushing to buffer     |
| `src/pipeline/adapters/gemini.ts:89-103` | drain on text chunks only            |
| `src/pipeline/adapters/gemini.ts:62-63`  | `as never` type cast                 |
| `src/pipeline/adapters/gemini.ts:73-85`  | stream args cast                     |

## Remediation direction

If the Gemini SDK exposes a unified event stream that includes tool events,
consume it directly. Otherwise, introduce an adapter-level async generator
that interleaves tool events from the callback with text-chunk events from the
stream (e.g. using an async queue), so tool frames can be yielded independently
of when text arrives.

For the type casts: define per-provider model ID types so Gemini model IDs are
typed as `GeminiModelId` rather than the union, eliminating the `as never` and
related casts.
