# Scratch Demo Scripts

These scripts are a guided tour of Orb's core architecture. They are arranged
in the same order you would use to reconstruct the app from scratch.

Each script targets one of the five primitives distilled in `ARCHITECTURE.md`
plus two supporting primitives (execution sandbox, TTS sidecar).

## Quick Start

```bash
bun run scratch/01-smart-provider.ts
bun run scratch/02-config-resolution.ts
bun run scratch/03-adapter-normalization.ts
bun run scratch/04-streaming-tts-runtime.ts
bun run scratch/05-pipeline-task-runtime.ts
bun run scratch/06-session-persistence.ts
bun run scratch/07-sandbox-tools.ts
bun run scratch/99-compose.ts
```

## Primitive Map

| Script | ARCHITECTURE primitive | What it demonstrates |
| ------ | ---------------------- | -------------------- |
| `01` | 1. Startup funnel | CLI + global config + smart-provider + session lookup → one `AppConfig` |
| `03` | 2. Canonical frame stream + 3. Provider normalization | Anthropic and OpenAI SDK events collapse into one `Frame` vocabulary |
| `05` | 4. Orchestration | `PipelineTask` runs processors, manages task state, stale-run invalidation, and the transport boundary |
| `02` | 4. Projection | `useConversation()` turns outbound frames into live/completed turns + persisted session |
| `06` | 5. Memory layers | Project-session path derivation, v1→v2 migration, normalization, save rewriting |
| `07` | OpenAI execution boundary | `Sandbox` interface + owned `bash`/`readFile`/`writeFile` tools wired via `experimental_context` |
| `04` | TTS sidecar | Streaming controller hangs off `agent-text-delta` with sentence / timeout / forced-split chunking |
| `99` | End-to-end composition | One `submit()` call threaded through real `PipelineTask` + transport + `useConversation` + session write; only agent/tts processors mocked |

### Script deep-dives

#### 01 — Startup Funnel
Inspect the startup call order, when smart-provider detection runs vs. skips,
and the exact config that reaches `App`.

#### 02 — Conversation Projection
Inspect `startEntry()` creating the live turn, tool-call frames mutating it,
and `handleRunComplete()` archiving the turn + triggering persistence.

#### 03 — Provider Normalization
Inspect shared helper normalization, Anthropic session/text/tool frames, and
OpenAI text/tool frames including synthetic recovery for orphan tool results.

#### 04 — TTS Sidecar
Inspect sentence-boundary chunking, timeout-driven flushes, forced splits, and
finalize behavior when no timer flush occurs.

#### 05 — Pipeline Orchestrator
Inspect state transitions, outbound transport ordering, cancellation with
exactly-once stop, and stale-run invalidation via the run counter.

#### 06 — Session Memory
Inspect stable session-path derivation, v1→v2 migration, provider-aware
normalization, wrong-path rejection, and `saveSession()` path/timestamp rewrite.

#### 07 — Sandbox + Owned Tools
Inspect the `Sandbox` contract (`exec` / `readFile` / `writeFile` / `dispose`),
the three owned tools running against a `LocalSubprocessSandbox`, root-clamped
writes with symlink-escape protection, and abort-signal propagation.

## Side Effects

| Script | Side Effects |
| ------ | ------------ |
| `01` | No persistent side effects; mocks startup dependencies in-process |
| `02` | Writes one real session file under `~/.orb/sessions/`, then cleans it up |
| `03` | No persistent side effects; mocks provider SDK modules and the sandbox factory in-process |
| `04` | No persistent side effects; mocks TTS generation/playback in-process |
| `05` | No persistent side effects; mocks pipeline processors in-process |
| `06` | Writes real session fixture files under `~/.orb/sessions/`, then cleans the exact files up; `loadSession()` still triggers 30-day cleanup there |
| `07` | Real subprocess execution against a temp-dir project; temp dir is cleaned up at the end |
| `99` | Writes one real session file under `~/.orb/sessions/` (temp project), then cleans it up |

## Reconstruction Order

If you only run a few scripts, use this order — it mirrors the "minimal
reconstruction" section in `ARCHITECTURE.md`:

1. `01` to understand startup
2. `03` to understand the shared frame protocol
3. `07` to understand the execution boundary the OpenAI adapter depends on
4. `05` to understand orchestration
5. `02` to understand how the UI projects those frames
6. `04` to understand TTS as a sidecar
7. `06` to understand persistence
8. `99` to see all the above wired together on the critical path

## Shipping Checklist

- Verify startup resolves to the provider/model/config you expect.
- Verify both providers emit the frame kinds your UI logic expects.
- Verify the sandbox clamps writes, follows aborts, and the tools surface errors cleanly.
- Verify the task orchestrator cannot get stuck during TTS or cancellation.
- Verify TTS chunking feels acceptable for your default tuning.
- Verify session continuity and provider switching behave the way you want across real runs.

## Surprises

Non-obvious things these scripts surface that are hard to see from static reading:

- **`cancel` frame type is vestigial.** It exists in the `Frame` union but cancellation is driven directly through `task.cancel()` — nothing pipes cancel frames through the transport today. (`05`)
- **The completion handle is deliberately internal.** TTS completion is handed off from the processor into `PipelineTask` via `runControl.setCompletion(...)` and never leaves the orchestrator as a frame. (`05`)
- **Stale-run protection is a counter, not a lock.** Starting a new run mid-flight invalidates the older run's late frames via an incrementing `runCounter`; the older generator keeps yielding but its output is dropped. (`05`)
- **Orphan tool results are silently accepted.** The Anthropic adapter attaches unmatched `tool_result` blocks to a synthetic `toolIndex` rather than dropping them, which is how `03` sees an "extra" result frame. (`03`)
- **`readFile` is NOT path-clamped.** Only `writeFile` is clamped to `rootDir`. The sandbox intentionally allows reads outside the project root. (`07`)
- **Path-clamping survives symlink tricks.** `writeFile` uses `realpath` on the deepest existing ancestor before joining the unresolved suffix, so a symlink pointing outside the root still triggers `PathEscapeError`. (`07`)
- **`loadSession()` has a hidden side effect.** Every load triggers `cleanupOldSessions()` against `~/.orb/sessions/`, pruning files older than 30 days. (`06`)
- **`saveSession()` rewrites what you pass in.** Relative `projectPath` and stale `lastModified` are replaced on write, so the caller's input object diverges from what lands on disk. (`06`)

## Mental Model

If you had to explain Orb in two minutes:

> Orb is a frame pipeline wrapped in an Ink UI. Startup collapses many config
> sources into one `AppConfig`. At runtime, each user query becomes a
> `user-text` frame fed into `createPipeline([agent, tts])`. The agent
> processor dispatches to a provider adapter (Anthropic or OpenAI) that
> translates vendor-specific streaming events into the same canonical `Frame`
> vocabulary. `PipelineTask` routes outbound frames through a transport;
> `useConversation` projects them into live turns and persists a session per
> project. OpenAI's tool execution lives behind a narrow `Sandbox` interface,
> so tools don't know or care whether execution is local, remote, or
> virtualized. TTS is a sidecar that observes text deltas without mutating the
> frame contract.

