# Scratch Demo Scripts

Runnable demonstrations that import real production seams and print intermediate
state so a developer can inspect what the app actually does before shipping.

## Quick Start

```bash
bun run scratch/01-smart-provider.ts
bun run scratch/02-config-resolution.ts
bun run scratch/03-adapter-normalization.ts
bun run scratch/04-streaming-tts-runtime.ts
bun run scratch/05-pipeline-task-runtime.ts
bun run scratch/06-session-persistence.ts
```

## Scripts

### 01 — Smart Provider Selection Waterfall

Calls the real `resolveSmartProvider()` on this machine, then runs fixture-backed
token payloads through `findToken()` and `parseCodexAuthFile()` to show where
"token-looking" auth diverges from valid access+refresh token pairs.

Inspect:
- Which provider wins locally and how long the Claude probe took
- The mismatch between heuristic token detection and full token parsing
- Why those fixture payloads no longer affect provider selection

### 02 — CLI Config Resolution

Runs `parseCliArgs()` across common argument shapes, then captures the real config
that `run()` passes into `App` after OpenAI streaming defaults are applied.

Inspect:
- Alias expansion and `provider:model` parsing
- Explicit flags vs inferred defaults
- The real OpenAI TTS overrides that happen in `src/index.ts`

### 03 — Adapter Normalization Seams

Exercises the shared adapter helpers directly, then drives both provider adapters
with mocked SDK layers to show how frames are normalized.

Inspect:
- `normalizeToolInput()`, `formatToolResult()`, and `isToolError()`
- Anthropic dropping unmatched `tool_result` blocks
- OpenAI synthesizing `tool-call-start` for orphan results

### 04 — Streaming TTS Runtime

Mocks the TTS backend but drives the real `createStreamingSpeechController()` so
chunk generation comes from production code rather than copied regex logic.

Inspect:
- Sentence boundary chunking
- Timer-based flushes, grace windows, and finalize behavior
- Forced splitting of long text with no whitespace
- The effect of `ttsMaxWaitMs=0`

### 05 — PipelineTask Runtime

Mocks the agent and TTS processors, then runs the real `createPipelineTask()`
through success, cancellation, and stale-run scenarios.

Inspect:
- Outbound frame order
- State transitions during speaking
- Why the completion handle stays internal
- Cancellation stopping active TTS once
- Late frames from an old run being dropped

### 06 — Session Persistence

Creates isolated fixture projects and real session files to prove load/save
normalization behavior.

Inspect:
- `getSessionPath()` output
- V1→V2 migration
- Invalid provider fallback to `anthropic`
- Invalid OpenAI session payloads being dropped
- `saveSession()` rewriting absolute paths and timestamps

## Side Effects

| Script | Side Effects |
| ------ | ------------ |
| `01` | Runs the live Claude SDK auth probe and reads the current `~/.codex/auth.json`; fixture cases use a temporary `CODEX_HOME` and clean it up |
| `02` | No persistent side effects; mocks `ink` and `loadSession()` while capturing `run()` |
| `03` | No persistent side effects; mocks provider SDK modules in-process |
| `04` | No persistent side effects; mocks TTS generation/playback in-process |
| `05` | No persistent side effects; mocks pipeline processors in-process |
| `06` | Writes real session fixture files under `~/.orb/sessions/`, then cleans the exact files up; `loadSession()` still triggers 30-day cleanup there |

## Observed Behavior

- `01` resolved to `anthropic via claude-oauth` in about `2933ms` on this machine.
- `02` confirmed `run()` applies OpenAI streaming defaults of `3 / 60 / 600 / 200 / true`, and preserves an explicit `--tts-max-wait-ms=250`.
- `03` confirmed the Anthropic fixture emitted only one `tool-call-result` frame for two `tool_result` blocks, while the OpenAI fixture synthesized a `tool-call-start` for an orphan result.
- `04` confirmed a 250-character no-whitespace input splits into `200ch` then `50ch`, and `ttsMaxWaitMs=0` prevents timer-based flushes before `finalize()`.
- `05` confirmed outbound frames exclude the internal completion handle, cancellation stops active TTS once, and a stale slow run drops its late completion.
- `06` confirmed invalid providers normalize to `anthropic`, invalid OpenAI session payloads are dropped, and `saveSession()` rewrites paths and timestamps.

## Shipping Checklist

- Verify the expected provider wins for your actual local auth state.
- Verify the CLI args you plan to document resolve to the provider/model you expect.
- Verify adapter normalization would not hide the tool results you care about.
- Verify TTS chunking feels acceptable under both Anthropic-style and OpenAI-style thresholds.
- Verify cancellation cannot leave the app stuck in a speaking state.
- Verify session continuity and provider switching behave the way you want across real runs.
