# Architecture

orb is a voice-driven code explorer built with Ink (React for terminals), pocket-tts, and pluggable LLM providers: Anthropic via the Claude Agent SDK and OpenAI via the AI SDK + bash-tool.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Terminal UI (Ink)                          │
├─────────────────────────────────────────────────────────────────┤
│  WelcomeSplash / OrbPanel / ActiveMessagePanel                  │
│  CompletedEntry (history) + ToolTree (tool calls)               │
│  InputPrompt (user input)                                       │
│                                                                 │
│  ResonanceBar (status + model)   TTSErrorBanner                 │
│  TranscriptViewer (Ctrl+O)                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │     runAgent()      │
                    │ provider router     │
                    └─────────┬───────────┘
             ┌────────────────┴────────────────┐
             ▼                                 ▼
 ┌──────────────────────────┐        ┌───────────────────────────┐
 │ Anthropic (Claude SDK)   │        │ OpenAI (AI SDK + bash-tool)│
 │ streaming query          │        │ ToolLoopAgent             │
 └────────────┬─────────────┘        └─────────────┬─────────────┘
      ┌───────┼───────┐                     ┌───────┼────────┐
      ▼       ▼       ▼                     ▼       ▼        ▼
   Glob     Read     Bash                 bash   readFile  writeFile
    Grep                                 (sandbox overlay)
             \____________________  _____________________/
                              ▼
                    ┌─────────────────────┐
                    │  Streaming TTS      │
                    │  (pocket-tts)       │
                    └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │  Audio Playback     │
                    │  (afplay)           │
                    └─────────────────────┘
```

## Directory Structure

```
src/
├── index.ts              # Library entry, exports run()
├── cli.ts                # CLI entry with #!/usr/bin/env bun
├── config.ts             # CLI parsing + defaults
├── types/
│   └── index.ts          # Types, models, defaults
├── services/
│   ├── agent/
│   │   ├── anthropic.ts  # Claude Agent SDK runner
│   │   ├── openai.ts     # OpenAI AI SDK runner
│   │   └── index.ts      # Provider router
│   ├── auth-utils.ts     # Codex token helpers
│   ├── openai-auth.ts    # OpenAI OAuth/API key resolver
│   ├── provider-defaults.ts # Smart provider detection
│   ├── session.ts        # Session persistence (load/save/cleanup)
│   ├── tts.ts            # Text-to-speech (batch mode)
│   └── streaming-tts.ts  # Streaming TTS controller
└── ui/
    ├── App.tsx           # Root component, state machine
    ├── components/
    │   ├── ActiveMessagePanel.tsx
    │   ├── AsciiOrb.tsx
    │   ├── CompletedEntry.tsx
    │   ├── InputPrompt.tsx
    │   ├── OrbPanel.tsx
    │   ├── ResonanceBar.tsx
    │   ├── TTSErrorBanner.tsx
    │   ├── TranscriptViewer.tsx
    │   ├── WelcomeSplash.tsx
    │   └── shared/
    │       ├── EntryContent.tsx
    │       └── ToolTree.tsx
    ├── hooks/
    │   └── useTerminalSize.ts
    └── utils/
        ├── markdown.ts
        └── text.ts
```

## Data Flow

### Request Lifecycle

1. **User Input** → `InputPrompt` captures text, triggers `handleSubmit`
2. **State: processing** → App disables input, shows "thinking" indicator
3. **Agent Routing** → `runAgent()` selects Anthropic or OpenAI runner
4. **Tool Execution** → Anthropic uses Glob/Read/Grep/Bash (local tools); OpenAI uses `bash`/`readFile`/`writeFile` via `bash-tool` in a sandbox overlay
5. **Assistant Text** → Text chunks stream to `ActiveMessagePanel` and TTS
6. **State: processing_speaking** → Speech begins while the model still streams
7. **State: speaking** → LLM done, audio playback continues
8. **State: idle** → Audio complete, ready for next question

### Session Continuity

```typescript
const { text, session } = await runAgent(prompt, config, agentSessionRef.current, callbacks)
if (session) agentSessionRef.current = session
```

For Anthropic, the session is the Claude Agent SDK session ID; for OpenAI, it is the message history used to reconstruct the conversation.

## Session Persistence

On startup, the app loads the last saved session for the current project (unless `--new` is set). Sessions are stored under `~/.orb/sessions/` as `<project>-<hash>.json` and include provider, model, agent session data, history, and `lastModified`. Old sessions are pruned after 30 days. The app saves after each completed exchange and whenever the model changes.

## Key Components

### Agent Integration (`src/services/agent/`)

`runAgent()` routes to provider-specific runners:

- **Anthropic** (`anthropic.ts`) uses `@anthropic-ai/claude-agent-sdk` streaming and emits assistant text, tool calls, and session IDs
- **OpenAI** (`openai.ts`) uses the AI SDK `ToolLoopAgent` with `bash-tool`, emitting tool calls/results from `bash`/`readFile`/`writeFile` (sandbox overlay)
- **Auth & defaults**: `openai-auth.ts` resolves API key vs ChatGPT OAuth and enforces Codex model limits; `provider-defaults.ts` implements smart provider selection

The app passes `permissionMode` to the Claude SDK and renders tool progress consistently across providers.

### Terminal UI (`src/ui/`)

Built with **Ink** (React for terminals) and **@inkjs/ui** components.

**Component Hierarchy:**

```
App
├── WelcomeSplash (shown once on startup)
├── CompletedEntry (history via Static)
│   └── EntryContent
│       ├── Question box
│       ├── Tool call tree
│       └── Answer box
├── ActiveMessagePanel (current question + streaming answer)
├── OrbPanel (wide layouts)
├── ResonanceBar (status + model + shortcuts)
├── TTSErrorBanner (conditional)
├── TranscriptViewer (Ctrl+O, replaces main view)
└── InputPrompt (at bottom)
```

**State Machine:**

```typescript
type AppState = 'idle' | 'processing' | 'processing_speaking' | 'speaking'
```

| State                 | Input    | Indicator    | Audio   |
| --------------------- | -------- | ------------ | ------- |
| `idle`                | enabled  | "◉ ready"    | none    |
| `processing`          | disabled | "⠙ thinking" | none    |
| `processing_speaking` | disabled | "▅▆▇" wave   | playing |
| `speaking`            | disabled | "▅▆▇" wave   | playing |

### TTS Services (`src/services/tts.ts`, `streaming-tts.ts`)

**Batch Mode (`tts.ts`):**

- Generates all audio after the model finishes
- Simpler, but higher perceived latency

**Streaming Mode (`streaming-tts.ts`):**

- Generates audio incrementally as text arrives
- Dual queues: `sentenceQueue` (pending) → `audioQueue` (ready)
- Configurable buffer and chunking (`ttsBufferSentences`, clause boundaries, min chunk length, max wait)

**Text Processing:**

1. Strip markdown (code blocks → "code block", inline code → "code")
2. Split on strong sentence boundaries, optionally on clause boundaries or timeouts
3. Generate via pocket-tts CLI or server
4. Play via macOS `afplay`

## Configuration

### AppConfig Interface

```typescript
interface AppConfig {
  projectPath: string
  permissionMode: 'default' | 'acceptEdits'
  llmProvider: 'anthropic' | 'openai'
  llmModel: string
  openaiApiKey?: string
  openaiLogin: boolean
  openaiDeviceLogin: boolean
  openaiApi: 'responses' | 'chat'
  ttsVoice: Voice
  ttsMode: 'generate' | 'serve'
  ttsServerUrl?: string
  ttsSpeed: number
  ttsEnabled: boolean
  ttsStreamingEnabled: boolean
  ttsBufferSentences: number
  ttsClauseBoundaries: boolean
  ttsMinChunkLength: number
  ttsMaxWaitMs: number
  ttsGraceWindowMs: number
  startFresh: boolean
}
```

### CLI Argument Parsing

```bash
orb [projectPath] [options]

# Examples
orb                           # cwd, defaults
orb ~/projects/myapp          # specific path
orb --model=sonnet --voice=marius
orb --provider=openai --model=gpt-5.2-codex
```

## Error Handling

### TTSError Class

```typescript
class TTSError extends Error {
  type: 'command_not_found' | 'audio_playback' | 'generation_failed' | 'unknown'
  originalError?: Error
}
```

**Error Categories:**

- `command_not_found` - pocket-tts or afplay not installed
- `audio_playback` - afplay failed (file issue, interruption)
- `generation_failed` - pocket-tts generation error
- `unknown` - Unexpected errors

**Graceful Degradation:**

- TTS errors display banner but don't crash the app
- User can continue asking questions without audio

## Extension Points

### Adding or Changing Models

1. Update `ANTHROPIC_MODELS` in `src/types/index.ts`
2. Update `ANTHROPIC_MODEL_ALIASES` and `DEFAULT_MODEL_BY_PROVIDER` in `src/config.ts`
3. Update `CODEX_ALLOWED_MODELS` in `src/services/openai-auth.ts` if ChatGPT OAuth should allow it
4. Update UI labels in `ResonanceBar` if needed

### Custom TTS Providers

The TTS layer is abstracted behind `speak()` and `StreamingSpeechController`. To add a new provider:

1. Implement the same interface in a new service file
2. Add a config option for provider selection
3. Wire up in `App.tsx`

### New UI Components

Ink uses React patterns. Add components to `src/ui/components/` and compose in `App.tsx`.

## Dependencies

| Package                          | Purpose                             |
| -------------------------------- | ----------------------------------- |
| `@anthropic-ai/claude-agent-sdk` | Claude Agent SDK + tool use         |
| `ai`                             | AI SDK (ToolLoopAgent)              |
| `@ai-sdk/openai`                 | OpenAI provider for AI SDK          |
| `bash-tool`                      | Sandboxed bash/read/write tools     |
| `ink`                            | React renderer for terminals        |
| `@inkjs/ui`                      | Terminal UI components              |
| `react`                          | Component framework                 |

## Build & Distribution

- **Build**: tsup bundles TypeScript → ESM JavaScript
- **CLI**: `dist/cli.js` has shebang, registered in `package.json` bin
- **Library**: `dist/index.js` exports `run()`, types, and components
- **Package**: Only `dist/` ships (source not included)
