# Architecture

orb is a Bun + Ink terminal app for code exploration with Anthropic, OpenAI/Codex, and Gemini backends, optional text-to-speech, project-scoped session persistence, and a separate global defaults layer under `~/.orb/config.toml`.

The current production runtime is centered on the frame-based pipeline under `src/pipeline/**`, with `src/ui/App.tsx` as the composition root. Older `services/agent/*` descriptions are obsolete and should not be used as the main mental model.

## Orb Distilled

If you compress the current codebase down to its essential behavior, Orb is five primitives:

1. **Startup funnel**: turn CLI args, global defaults, credential discovery, and saved session lookup into one runtime config.
2. **Canonical frame stream**: represent runtime work as a compact shared protocol like `user-text`, `agent-text-delta`, `tool-call-*`, and `tts-*`.
3. **Provider normalization**: convert Anthropic, OpenAI/Codex, and Gemini streaming/tool events into that shared frame protocol.
4. **Projection and orchestration**: `PipelineTask` moves frames through processors, while the UI projects outbound frames into visible conversation state.
5. **Memory layers**: global defaults live in `~/.orb/config.toml`; project conversation continuity lives in `~/.orb/sessions/*.json`.

Everything else is support structure around those five ideas.

### What Was Discarded

- Visual component details below the composition-root level
- Provider SDK specifics that do not affect the shared frame contract
- Helper utilities that do not change runtime behavior
- Historical agent architecture that is no longer on the critical path

### Minimal Reconstruction

If you had to rebuild Orb from scratch, the shortest faithful path would be:

1. Parse startup inputs into one `AppConfig`
2. Create a canonical `Frame` union
3. Write one adapter per provider that emits frames
4. Pipe frames through an orchestrator that handles task state and TTS side effects
5. Project outbound frames into UI history and persist sessions

The `scratch/` demos mirror that reconstruction order.

## Runtime Overview

```text
┌─────────────────────────────────────────────────────────────┐
│ CLI bootstrap                                              │
│ src/cli.ts -> run(args) in src/index.ts                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Command routing                                             │
│ "orb setup" -> src/setup.ts                                │
│ all other args -> normal app startup                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Startup                                                    │
│ loadGlobalConfig()                                         │
│ applyGlobalConfig(DEFAULT_CONFIG, global config)           │
│ parseCliArgs()                                             │
│ resolveSmartProvider() when provider/model omitted         │
│ applyOpenAiStreamingDefaults()                             │
│ loadSession() unless --new                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Ink app                                                    │
│ render(<App config initialSession />)                      │
│                                                            │
│ App owns top-level UI state and composes                   │
│ useConversation() + usePipeline() + keyboard/layout hooks  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ PipelineTask                                               │
│ user-text frame -> createPipeline([agent, tts])            │
│ state machine: idle -> processing ->                       │
│ processing_speaking / speaking -> idle                     │
└─────────────────────────────────────────────────────────────┘
                 │                               │
                 ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│ Agent processor              │   │ TTS processor            │
│ createAgentProcessor()       │   │ createTTSProcessor()     │
│                              │   │                          │
│ anthropic -> Claude SDK      │   │ streaming ->             │
│ openai -> Codex app-server   │   │ createStreamingSpeech... │
│ gemini -> AI SDK ToolLoop    │   │ batch -> speak()         │
│ + owned tools + sandbox      │   │                          │
└──────────────────────────────┘   └──────────────────────────┘
                 │                               │
                 └──────────────┬────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ Outbound frames                                             │
│ agent-text-delta / tool-call-* / tts-* / agent-error        │
│ routed through terminal transport back into UI state        │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```text
src/
├── cli.ts                    # Bun CLI entrypoint
├── index.ts                  # run(), setup routing, Ink render
├── setup.ts                  # Interactive `orb setup` flow
├── config.ts                 # Commander parsing + CLI defaults
├── types/
│   └── index.ts              # Shared app/session/TTS types and defaults
├── pipeline/
│   ├── frames.ts             # Frame model flowing through the pipeline
│   ├── processor.ts          # Processor type + singleFrame helper
│   ├── pipeline.ts           # Left-to-right processor composition
│   ├── task.ts               # PipelineTask state machine
│   ├── observer.ts           # Observer interface
│   ├── observers/
│   │   └── metrics.ts        # Metrics observer (mainly test-facing today)
│   ├── adapters/
│   │   ├── anthropic.ts      # Claude Agent SDK adapter
│   │   ├── openai.ts         # Codex app-server adapter for OpenAI/ChatGPT auth
│   │   ├── gemini.ts         # Gemini AI SDK adapter + owned tool wiring
│   │   ├── types.ts          # AgentAdapter contract
│   │   └── utils.ts          # Tool/result parsing helpers
│   ├── sandbox/
│   │   ├── factory.ts        # Sandbox construction for providers/tools
│   │   ├── interface.ts      # Narrow exec/read/write sandbox contract
│   │   └── local-subprocess.ts # Bun.spawn-based local sandbox
│   ├── tools/
│   │   ├── bash.ts           # `bash -lc` tool exposed to AI SDK providers
│   │   ├── context.ts        # experimental_context -> ToolCtx bridge
│   │   ├── read.ts           # UTF-8 file reads for AI SDK providers
│   │   └── write.ts          # Project-root-clamped writes for AI SDK providers
│   ├── processors/
│   │   ├── agent.ts          # Provider dispatch into adapters
│   │   └── tts.ts            # Streaming/batch TTS frame handling
│   └── transports/
│       ├── terminal-text.ts  # In-memory outbound transport used by the UI
│       └── types.ts          # Transport contracts
├── services/
│   ├── auth-utils.ts         # Local auth helper utilities
│   ├── global-config.ts      # ~/.orb/config.toml parsing and writing
│   ├── gemini-auth.ts        # Gemini API-key resolution
│   ├── prompts.ts            # Prompt file composition for providers/TTS
│   ├── provider-defaults.ts  # Smart provider detection
│   ├── session.ts            # Session load/save/migration/cleanup
│   ├── streaming-tts.ts      # Incremental speech controller
│   └── tts.ts                # Audio generation + playback helpers
└── ui/
    ├── App.tsx               # Root Ink component and composition root
    ├── hooks/
    │   ├── useConversation.ts
    │   ├── useKeyboardShortcuts.ts
    │   ├── usePipeline.ts
    │   ├── useTerminalSize.ts
    │   └── useAnimationFrame.ts
    ├── input/
    │   ├── TextBuffer.ts     # Multiline editor state + editing ops
    │   ├── keymap.ts         # Ink key normalization into editor actions
    │   └── paste.ts          # Bracketed-paste cleanup for terminal input
    ├── components/
    │   ├── ConversationRail.tsx
    │   ├── Footer.tsx
    │   ├── InputPrompt.tsx
    │   ├── WelcomeSplash.tsx
    │   ├── TTSErrorBanner.tsx
    │   ├── TurnRow.tsx
    │   ├── ActivityTimeline.tsx
    │   ├── AsciiOrb.tsx
    │   └── MicroOrb.tsx
    └── utils/
        ├── markdown.ts
        ├── model-label.ts
        ├── text.ts
        └── tool-format.ts

prompts/
├── base.md                   # Shared prompt foundation
├── anthropic.md              # Anthropic-specific instructions
├── openai.md                 # OpenAI/Codex-specific instructions
├── gemini.md                 # Gemini-specific instructions
└── voice.md                  # Extra voice/TTS prompt layer when TTS is enabled
```

## Startup and Configuration Flow

`run(args)` in `src/index.ts` currently performs startup in this order:

1. Route `setup` to `runSetupCommand()` in `src/setup.ts`.
2. Load `~/.orb/config.toml` with `loadGlobalConfig()`.
3. Merge global defaults into `DEFAULT_CONFIG` with `applyGlobalConfig()`.
4. Parse CLI arguments with `parseCliArgs()`, preserving which values were explicit.
5. If provider and model were both omitted, probe credentials with `resolveSmartProvider()`.
6. Resolve the semantic model alias against the live/cached model catalog.
7. If OpenAI + streaming TTS is active, apply the OpenAI-specific chunking defaults.
8. Load the prior project session with `loadSession()` unless `--new` was passed, then apply any explicit provider handoff session.
9. Render `<App config initialSession />`.

### Global config vs session state

- Global config in `~/.orb/config.toml` stores user defaults like provider, model, intro behavior, and TTS tuning.
- Per-project session files in `~/.orb/sessions/*.json` store conversation history, active provider/model, and provider-specific continuation state.
- CLI flags override global config for a single run.
- Session restore is provider-aware: `useConversation()` only restores saved history and agent continuation state when the restored session provider matches the current runtime provider.
- Explicit handoff flags (`--resume-session`, `--claude-session`, `--codex-thread`) build an initial provider session even when Orb has no saved session for the project. The project path must match the provider session's original working directory. If the saved Orb session already points at the same provider session, Orb keeps visible history; otherwise the UI starts clean while the provider resumes backend context.
- OpenAI/Codex defaults to `gpt-5.5` with `high` reasoning effort; `reasoning_effort` in global config or `--reasoning-effort` can override the effort.

### Smart provider selection

When the user does not pass `--provider` or `--model`, `resolveSmartProvider()` prefers:

1. Codex CLI signed in with ChatGPT
2. Claude OAuth / Max detected through the Claude Agent SDK
3. `GOOGLE_GENERATIVE_AI_API_KEY`
4. Claude/Anthropic API-key based Anthropic access

If no valid credentials are found, startup exits before rendering the Ink UI.

## App and UI State

`src/ui/App.tsx` is the composition root.

It owns:

- `detailMode`
- top-level runtime `state`
- welcome-splash dismissal state
- layout derivation like `maxAnswerLines`

It delegates most runtime behavior to hooks:

- `useConversation()` owns turn history, provider-aware initial session restore, active model selection, frame application, TTS error banners, and session persistence.
- `usePipeline()` owns the long-lived `PipelineTask`, the terminal transport subscription, submit/cancel actions, and config updates.
- `useKeyboardShortcuts()` binds global keys like cancel and provider model cycling.
- `useTerminalSize()` drives answer-height/layout behavior.

The main render path is:

- `WelcomeSplash` for the empty-state landing screen
- `ConversationRail` for the live transcript view
- `Footer` for input, model state, and shortcuts
- `TTSErrorBanner` for degraded-audio warnings

`ConversationRail` then renders turn-level pieces like `TurnRow`, `ActivityTimeline`, and the orb visuals.

## Frame Pipeline

The production request path is frame-based:

1. `Footer` calls `submit(query)` from `usePipeline()`.
2. `startEntry()` in `useConversation()` creates a new live `HistoryEntry`.
3. `PipelineTask.run()` creates a single `user-text` frame.
4. `createPipeline()` composes processors left-to-right:
   - `createAgentProcessor()`
   - `createTTSProcessor()`
5. Displayable frames are routed through `transport.sendOutbound()`.
6. `useConversation().handleFrame()` applies those outbound frames back into the live turn and TTS banner state.
7. `handleRunComplete()` archives the live turn and persists the session when appropriate.

Important frame kinds in the current model:

- `user-text`
- `agent-text-delta`
- `agent-text-complete`
- `agent-session`
- `tool-call-start`
- `tool-call-result`
- `tts-speaking-start`
- `tts-speaking-end`
- `tts-error`
- `agent-error`
- `cancel` exists in the frame union but is not part of the current outbound UI transport path

`PipelineTask` also manages:

- cancellation via `AbortController`
- stale-run invalidation via an incrementing run counter
- TTS completion handoff for post-model playback completion
- coarse task state transitions between `idle`, `processing`, `processing_speaking`, and `speaking`

## Provider Adapters

### Prompt construction

Both provider adapters build their instruction text through `buildProviderPrompt()` in `src/services/prompts.ts`.

Prompt composition is:

1. `prompts/base.md`
2. provider-specific file (`anthropic.md`, `openai.md`, or `gemini.md`)
3. `prompts/voice.md` when TTS is enabled

The prompt layer interpolates the current project name and path into those templates.

### Anthropic

`createAnthropicAdapter()` wraps `@anthropic-ai/claude-agent-sdk`:

- streams assistant text blocks as `agent-text-delta`
- emits `agent-session` when Claude returns a session id
- resumes prior Claude sessions with `resume`, including explicit `--claude-session` handoffs from Claude Code
- emits tool start/result frames from Claude content blocks
- yields `agent-text-complete` on successful completion

### OpenAI

`createOpenAiAdapter()` wraps `codex app-server` over stdio:

- requires Codex to be signed in with ChatGPT subscription auth
- starts or resumes a Codex thread for the current project
- passes Orb's provider prompt as Codex developer instructions
- maps Codex streamed agent, command, tool, and file-change events into Orb frames
- persists the Codex `threadId` for continuation and accepts explicit `--codex-thread` handoffs

### Gemini

`createGeminiAdapter()` wraps the AI SDK plus Orb's owned tools/sandbox:

- resolves auth through `resolveGeminiProvider()`
- supports direct API-key access via `GOOGLE_GENERATIVE_AI_API_KEY`
- creates a `LocalSubprocessSandbox` rooted at the current project path
- injects `{ sandbox, signal }` through `experimental_context`
- exposes `bash`, `readFile`, and `writeFile` from `src/pipeline/tools/`
- uses `ToolLoopAgent` against the Google Generative AI provider

Important sandbox behavior today:

- `bash` runs via `bash -lc` and defaults to the project root, with optional relative `cwd`
- `readFile` allows absolute paths or project-relative paths
- `writeFile` is clamped to the project root and rejects path escapes or symlink escapes
- writes go to the real working tree; there is no overlay filesystem layer

## TTS Architecture

TTS is implemented as a processor-layer concern plus service helpers.

### Streaming mode

When `ttsStreamingEnabled` is true:

- `createTTSProcessor()` creates a `StreamingSpeechController`
- `agent-text-delta` frames feed incremental text into the controller
- the controller buffers text using sentence, clause, minimum-length, and timeout heuristics
- the controller emits `tts-speaking-start`, `tts-speaking-end`, and `tts-error` through queued side-effect frames
- on `agent-text-complete`, the processor finalizes the controller and hands a completion handle to `PipelineTask`
- `PipelineTask` awaits that handle after model completion so speech can finish after text generation ends

### Batch mode

When streaming is disabled:

- `agent-text-complete` registers a single completion handle
- `PipelineTask` awaits `speak(text, config)`
- playback occurs only after the full model response is available

### Audio backends

- `serve` mode posts to `POST /v1/speech` on a `tts-gateway`-compatible HTTP server, defaulting to `http://localhost:8000`
- streaming serve-mode playback uses `POST /tts/stream`
- `generate` mode uses local macOS generation/playback helpers
- `src/setup.ts` is the source of truth for the interactive setup flow and Kokoro gateway guidance

TTS failures are non-fatal by default: they surface as `tts-error` frames and UI banners instead of ending the conversation.

## Session Persistence

Sessions are stored under `~/.orb/sessions/` and keyed by:

- a sanitized project basename
- a short hash of the absolute project path

Saved session payloads include:

- version
- absolute `projectPath`
- `llmProvider`
- `llmModel`
- provider-specific `agentSession`
- conversation history
- `lastModified`

Explicit handoff sessions are not a separate storage format. They are converted into the same `agentSession` shape as saved sessions:

- Claude: `{ provider: "anthropic", sessionId }`
- Codex/OpenAI: `{ provider: "openai", threadId }`

`loadSession()` also migrates the older v1 Anthropic-only format into the current v2 multi-provider shape. Old session files are pruned after 30 days.

## Error Handling

`TTSError` is the main structured runtime error type for audio failures:

- `command_not_found`
- `audio_playback`
- `generation_failed`

Agent adapter failures are converted into `agent-error` frames unless they are recognized aborts. `useConversation()` applies those errors onto the live turn so the failure appears inline in the transcript.

## Current Production Caveats

These are intentional or notable aspects of the implementation today:

- `usePipeline()` creates the `PipelineTask` and terminal transport once on mount, then pushes later config/model changes through `task.updateConfig()`.
- The terminal transport is outbound-only in production. The UI does not send inbound frames through it.
- Observer support exists in `PipelineTask` and `createPipeline()`, but the app does not wire observers in normal runtime usage.
- Model cycling uses the resolved model choices attached to `AppConfig`, so providers can expose semantic aliases without hardcoding every release in the UI.
- The input box is a real multiline buffer: Enter submits, while `Ctrl+J` and `Alt+Enter` insert newlines.
- The `cancel` frame type exists in the shared frame union, but cancellation is currently handled directly through `task.cancel()` rather than by piping cancel frames through the transport.

## Extension Points

### Add or change model policy

1. Update provider alias policy in `src/services/model-catalog.ts` if Orb should expose a new semantic family such as a new provider tier.
2. Update fallback models in `src/services/model-catalog.ts` when a provider removes an older fallback or when offline behavior should change.
3. Revisit setup prompts and README examples if the human-facing default alias should change.

### Add a new provider

1. Extend `LlmProvider` and config defaults in `src/types/index.ts`.
2. Update provider parsing and default-model resolution in `src/config.ts`.
3. Extend global config parsing/writing in `src/services/global-config.ts`.
4. Add prompt support in `src/services/prompts.ts` and `prompts/`.
5. Implement the `AgentAdapter` contract in `src/pipeline/adapters/`.
6. Update `createAgentProcessor()` dispatch and any UI labeling helpers.

### Add a new transport or observer

1. Implement `Transport` under `src/pipeline/transports/` or `PipelineObserver` under `src/pipeline/`.
2. Wire it through `createPipelineTask()` or `usePipeline()` depending on whether it is runtime-facing or test/diagnostic-only.
