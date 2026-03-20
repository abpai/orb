# Architecture

orb is a Bun + Ink terminal app for code exploration with Anthropic and OpenAI backends, optional text-to-speech, and project-scoped session persistence.

The current production architecture is centered on a frame-based pipeline under `src/pipeline/**`. Older `services/agent/*` paths no longer exist and should not be treated as the main runtime model.

## Runtime Overview

```text
┌─────────────────────────────────────────────────────────────┐
│ CLI bootstrap                                              │
│ src/cli.ts -> run(args) in src/index.ts                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Startup                                                    │
│ parseCliArgs()                                             │
│ resolveSmartProvider() when provider/model omitted         │
│ loadSession() unless --new                                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Ink app                                                    │
│ render(<App config initialSession />)                      │
│                                                            │
│ App owns UI state, history, active model, transcript view, │
│ and a single PipelineTask + terminal transport instance.   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ PipelineTask                                               │
│ user-text frame -> createPipeline([agent, tts])            │
│ state machine: idle -> processing -> speaking -> idle      │
└─────────────────────────────────────────────────────────────┘
                 │                               │
                 ▼                               ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│ Agent processor              │   │ TTS processor            │
│ createAgentProcessor()       │   │ createTTSProcessor()     │
│                              │   │                          │
│ anthropic -> Claude SDK      │   │ streaming ->             │
│ openai -> AI SDK ToolLoop    │   │ createStreamingSpeech... │
│ + bash/readFile/writeFile    │   │ batch -> speak()         │
└──────────────────────────────┘   └──────────────────────────┘
                 │                               │
                 └──────────────┬────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────┐
│ Outbound frames                                             │
│ agent-text-delta / tool-call-* / tts-* / agent-error        │
│ sent through terminal transport back into App state/history │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```text
src/
├── cli.ts                    # Bun CLI entrypoint
├── index.ts                  # run(), package exports, Ink render
├── config.ts                 # Commander parsing + config defaults
├── types/
│   └── index.ts              # Shared types, models, TTSError, defaults
├── pipeline/
│   ├── frames.ts             # Frame model flowing through the pipeline
│   ├── processor.ts          # Processor type + singleFrame helper
│   ├── pipeline.ts           # Left-to-right processor composition
│   ├── task.ts               # PipelineTask state machine
│   ├── observer.ts           # Observer interface
│   ├── observers/
│   │   └── metrics.ts        # Metrics observer (not wired by App today)
│   ├── adapters/
│   │   ├── anthropic.ts      # Claude Agent SDK adapter
│   │   ├── openai.ts         # OpenAI AI SDK + bash-tool adapter
│   │   ├── types.ts          # AgentAdapter contract
│   │   └── utils.ts          # Tool/result parsing + shared prompt text
│   ├── processors/
│   │   ├── agent.ts          # Provider dispatch into adapters
│   │   └── tts.ts            # Streaming/batch TTS frame handling
│   └── transports/
│       ├── terminal-text.ts  # In-memory transport used by App
│       └── types.ts          # Transport contracts
├── services/
│   ├── auth-utils.ts         # Codex auth.json parsing helpers
│   ├── openai-auth.ts        # OpenAI API-key resolution
│   ├── provider-defaults.ts  # Smart provider detection
│   ├── session.ts            # Session load/save/migration/cleanup
│   ├── streaming-tts.ts      # Incremental speech controller
│   └── tts.ts                # Audio generation + playback helpers
└── ui/
    ├── App.tsx               # Root Ink component and UI state machine
    ├── components/           # Panels, prompts, transcript, banners
    ├── hooks/                # useTerminalSize, useAnimationFrame
    └── utils/                # markdown/text formatting helpers
```

## Startup and Provider Selection

`run(args)` in `src/index.ts` performs startup in this order:

1. Parse CLI arguments into `AppConfig`.
2. If the user did not set provider or model explicitly, probe credentials with `resolveSmartProvider()`.
3. Apply OpenAI-specific streaming TTS defaults when appropriate.
4. Load the previous project session unless `--new` was passed.
5. Print a small startup summary card.
6. Render `<App />` with the resolved config and initial session.

Smart provider selection prefers:

1. Claude OAuth / Max via the Claude Agent SDK
2. `OPENAI_API_KEY`
3. `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`

## App and UI State

`App` is the composition root. Runtime concerns are split across hooks:

- `useConversation()` owns history, session persistence, model cycling, and TTS error state
- `usePipeline()` owns task creation, transport subscription, run/cancel actions, and task state
- `useKeyboardShortcuts()` owns global input bindings
- `App` itself owns `viewMode`, layout decisions, and rendering composition

The main UI is composed from:

- `WelcomeSplash` for the empty state
- `CompletedEntry` rendered through `Static` for prior turns
- `ActiveMessagePanel` for the in-flight turn
- `InputPrompt` for text entry
- `ResonanceBar` for status, model, and shortcuts
- `TTSErrorBanner` for degraded-audio warnings
- `TranscriptViewer` for the alternate transcript screen

## Frame Pipeline

The production request path is frame-based:

1. `handleSubmit()` creates a history entry and calls `task.run(query, entryId)`.
2. `PipelineTask` creates a single `user-text` frame.
3. `createPipeline()` composes processors left-to-right:
   - `createAgentProcessor()`
   - `createTTSProcessor()`
4. Outbound frames are sent through `transport.sendOutbound()`.
5. `App` subscribes to `transport.onOutbound()` and updates history, tool state, and TTS errors from those frames.

Important frame kinds:

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

`PipelineTask` also tracks coarse runtime state and cancellation with `AbortController`.

## Provider Adapters

### Anthropic

`createAnthropicAdapter()` wraps `@anthropic-ai/claude-agent-sdk`:

- streams assistant messages from `query()`
- resumes prior Claude sessions when available
- emits tool calls/results and session IDs as frames
- passes `permissionMode` through to the SDK

### OpenAI

`createOpenAiAdapter()` wraps the AI SDK:

- resolves auth through `resolveOpenAiProvider()`
- requires `OPENAI_API_KEY` for direct API access
- uses `bash-tool` to expose `bash`, `readFile`, and `writeFile`
- emits tool calls/results and persists the last OpenAI response ID for continuation

## TTS Architecture

TTS is handled by the TTS processor plus service helpers.

### Streaming mode

When `ttsStreamingEnabled` is true:

- text deltas are fed into `createStreamingSpeechController()`
- the controller chunks cleaned text by sentence, clause, whitespace, and timeout heuristics
- chunks are generated into temporary audio files and played incrementally
- the processor emits `tts-speaking-start`, `tts-speaking-end`, and `tts-error`
- `PipelineTask` awaits a dedicated TTS completion handle after the model finishes

### Batch mode

When streaming is disabled:

- `agent-text-complete` registers a single TTS completion handle
- `PipelineTask` awaits `speak(text, config)`
- `speak()` cleans markdown, splits into sentences, generates audio, and plays each sentence in order

### Audio backends

- Generation mode `serve` posts to a `tts-gateway`-compatible server
- Generation mode `generate` shells out to `pocket-tts generate`
- Playback uses macOS `afplay`

## Session Persistence

Sessions are stored under `~/.orb/sessions/` and keyed by a sanitized project name plus a hash of the absolute project path.

Saved session payloads include:

- provider
- model
- agent session data
- conversation history
- `lastModified`

`loadSession()` supports migration from the older v1 Anthropic-only format to the current v2 multi-provider format. Old session files are pruned after 30 days.

## Auth and OpenAI Integration

OpenAI auth resolution supports direct API key use via `OPENAI_API_KEY` or `config.openaiApiKey`.
Orb talks to the official OpenAI Responses API only; the removed ChatGPT/Codex backend integration is no longer part of the runtime architecture.

## Error Handling

`TTSError` is the main structured runtime error type for audio failures:

- `command_not_found`
- `audio_playback`
- `generation_failed`

TTS failures are surfaced as UI banners and outbound `tts-error` frames; they do not terminate the session by default.

Agent failures become `agent-error` frames and are rendered into the current history entry.

## Current Production Caveats

These are part of the implementation today and worth knowing when working on the codebase:

- `App` uses the transport as an outbound event bus only; it calls `task.run()` and `task.cancel()` directly instead of using transport inbound events.
- Observer support exists in `PipelineTask` and `createPipeline()`, but `App` does not pass observers in production, so metrics observers are currently test-only.
- `App` creates `task` and `transport` once on mount and then pushes later config changes through `task.updateConfig()`.

## Extension Points

### Add or change models

1. Update `ANTHROPIC_MODELS` in `src/types/index.ts`.
2. Update aliases and defaults in `src/config.ts`.
3. Update UI model labels in `ResonanceBar` when needed.

### Add a new provider

1. Implement the `AgentAdapter` contract in `src/pipeline/adapters/`.
2. Route to it from `createAgentProcessor()`.
3. Extend `AppConfig` / CLI parsing if the provider needs new configuration.
4. Define how session continuity should be serialized in `AgentSession`.

### Add new pipeline behavior

1. Create a new processor in `src/pipeline/processors/`.
2. Insert it in `createPipelineTask()` in the desired order.
3. Add any new frame kinds to `frames.ts`.
4. Teach `App` / transport consumers how to render those frames if they are user-visible.
