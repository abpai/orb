# Scratch Demo Scripts

These scripts are a guided tour of Orb's core architecture. They are arranged in
the same order you would use to reconstruct the app from scratch.

## Quick Start

```bash
bun run scratch/01-smart-provider.ts
bun run scratch/02-config-resolution.ts
bun run scratch/03-adapter-normalization.ts
bun run scratch/04-streaming-tts-runtime.ts
bun run scratch/05-pipeline-task-runtime.ts
bun run scratch/06-session-persistence.ts
```

## The Primitive Set

### 01 — Startup Funnel

Shows how `run()` turns CLI args, global defaults, smart-provider detection, and
saved-session lookup into one runtime config.

Inspect:
- The startup call order
- When smart-provider detection runs and when it is skipped
- The exact config that reaches `App`

### 02 — Conversation Projection

Shows how `useConversation()` turns outbound frames into the UI's live turn,
completed history, TTS banner state, and persisted session data.

Inspect:
- `startEntry()` creating the live turn
- Tool call frames mutating the live turn
- `handleRunComplete()` archiving the turn and triggering persistence

### 03 — Provider Normalization

Shows how Anthropic and OpenAI events collapse into the same canonical frame
protocol, which is the real seam the rest of Orb depends on.

Inspect:
- Shared helper normalization
- Anthropic session/text/tool frames
- OpenAI text/tool frames and synthetic recovery behavior

### 04 — TTS Sidecar

Shows how streaming TTS hangs off the frame stream as a sidecar process instead
of changing the frame protocol itself.

Inspect:
- Sentence-boundary chunking
- Timeout-driven flushes
- Finalize behavior when no timer flush occurs

### 05 — Pipeline Orchestrator

Shows how `PipelineTask` composes processors, drives task state, routes outbound
frames, and keeps delayed TTS completion internal.

Inspect:
- State transitions
- Outbound transport ordering
- Cancellation and stale-run protection

### 06 — Session Memory

Shows the per-project memory layer: how session files are named, migrated,
normalized, and rewritten.

Inspect:
- Stable session-path derivation
- V1 to V2 migration
- Provider-aware session normalization
- `saveSession()` rewriting absolute paths and timestamps

## Side Effects

| Script | Side Effects |
| ------ | ------------ |
| `01` | No persistent side effects; mocks startup dependencies in-process |
| `02` | Writes one real session file under `~/.orb/sessions/`, then cleans it up |
| `03` | No persistent side effects; mocks provider SDK modules in-process |
| `04` | No persistent side effects; mocks TTS generation/playback in-process |
| `05` | No persistent side effects; mocks pipeline processors in-process |
| `06` | Writes real session fixture files under `~/.orb/sessions/`, then cleans the exact files up; `loadSession()` still triggers 30-day cleanup there |

## Reconstruction Order

If you only run a few scripts, use this order:

1. `01` to understand startup
2. `03` to understand the shared frame protocol
3. `05` to understand orchestration
4. `02` to understand how the UI projects those frames
5. `04` to understand TTS as a sidecar
6. `06` to understand persistence

## Shipping Checklist

- Verify startup resolves to the provider/model/config you expect.
- Verify both providers emit the frame kinds your UI logic expects.
- Verify the task orchestrator cannot get stuck during TTS or cancellation.
- Verify TTS chunking feels acceptable for your default tuning.
- Verify session continuity and provider switching behave the way you want across real runs.
