# Architecture

vibe-claude is a voice-driven code explorer built with the Claude Agent SDK, Ink (React for terminals), and pocket-tts.

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
                    │  Claude Agent SDK   │
                    │  (streaming query)  │
                    └─────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    ┌──────────┐        ┌──────────┐        ┌──────────┐
    │   Glob   │        │   Read   │        │   Bash   │
    │   Grep   │        │          │        │          │
    └──────────┘        └──────────┘        └──────────┘
                              │
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
├── cli.ts                # CLI entry with #!/usr/bin/env node
├── config.ts             # CLI argument parsing
├── types/
│   └── index.ts          # TypeScript types, constants, defaults
├── services/
│   ├── claude-agent.ts   # Claude SDK wrapper
│   ├── tts.ts            # Text-to-speech (batch mode)
│   └── streaming-tts.ts  # Streaming TTS controller
└── ui/
    ├── App.tsx           # Root component, state management
    ├── components/
    │   ├── ActiveMessagePanel.tsx # Active response panel
    │   ├── CompletedEntry.tsx     # Completed Q&A entry
    │   ├── ConversationPanel.tsx  # Legacy conversation layout
    │   ├── InputPrompt.tsx        # User input with cursor
    │   ├── OrbPanel.tsx           # Animated orb panel
    │   ├── ResonanceBar.tsx       # Status + model indicator
    │   ├── TTSErrorBanner.tsx     # Error notifications
    │   ├── TranscriptViewer.tsx   # Full conversation view
    │   └── WelcomeSplash.tsx      # Startup splash
    └── utils/
        └── markdown.ts   # Markdown → speech text conversion
```

## Data Flow

### Request Lifecycle

1. **User Input** → `InputPrompt` captures text, triggers `handleSubmit`
2. **State: processing** → App disables input, shows "thinking" indicator
3. **Claude Query** → `runAgent()` streams messages from Claude Agent SDK
4. **Tool Execution** → Claude calls Glob/Read/Grep/Bash, results stream back
5. **Assistant Text** → Text chunks stream to `ActiveMessagePanel` and TTS
6. **State: processing_speaking** → Speech begins while Claude still processes
7. **State: speaking** → Claude done, audio playback continues
8. **State: idle** → Audio complete, ready for next question

### Session Continuity

```typescript
sessionIdRef.current = message.session_id // Captured from system/init
runAgent(prompt, config, sessionIdRef.current, callbacks) // Passed to resume
```

The session ID enables multi-turn conversations where Claude remembers context.

## Key Components

### Claude Agent Integration (`src/services/claude-agent.ts`)

`runAgent()` wraps `@anthropic-ai/claude-agent-sdk` and streams:

- **Assistant text** → appended to the active response
- **Tool calls/results** → rendered in the tool tree
- **Session ID** → cached for multi-turn continuity

The app passes `permissionMode` through to the SDK (default prompts). Tool execution and permissions are handled by the SDK, while this UI renders the progress and results.

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
├── ResonanceBar (status + model indicator)
├── TTSErrorBanner (conditional)
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

- Generates all audio after Claude finishes
- Simpler, but higher perceived latency

**Streaming Mode (`streaming-tts.ts`):**

- Generates audio incrementally as text arrives
- Dual queues: `sentenceQueue` (pending) → `audioQueue` (ready)
- Configurable buffer (`ttsBufferSentences`) before playback starts

**Text Processing:**

1. Strip markdown (code blocks → "code block", inline code → "code")
2. Split on sentence boundaries (. ! ?)
3. Generate via pocket-tts CLI or server
4. Play via macOS `afplay`

## Configuration

### AppConfig Interface

```typescript
interface AppConfig {
  projectPath: string // Working directory for agent
  permissionMode: 'default' // Permission handling mode
  model: Model // haiku | sonnet | opus
  ttsVoice: Voice // alba | marius | jean
  ttsMode: 'generate' | 'serve' // CLI vs server
  ttsServerUrl?: string // Server URL (default: localhost:8000)
  ttsSpeed: number // Playback speed multiplier
  ttsEnabled: boolean // Toggle TTS
  ttsStreamingEnabled: boolean // Toggle streaming vs batch
  ttsBufferSentences: number // Sentences to buffer before playback
}
```

### CLI Argument Parsing

```bash
vibe-claude [projectPath] [options]

# Examples
vibe-claude                           # cwd, defaults
vibe-claude ~/projects/myapp          # specific path
vibe-claude --model=sonnet --voice=marius
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

1. Update `MODELS` in `src/types/index.ts`
2. Update `MODEL_ALIASES` in `src/config.ts` for CLI aliases
3. Update UI labels in `ResonanceBar` if needed

### Custom TTS Providers

The TTS layer is abstracted behind `speak()` and `StreamingSpeechController`. To add a new provider:

1. Implement the same interface in a new service file
2. Add a config option for provider selection
3. Wire up in `App.tsx`

### New UI Components

Ink uses React patterns. Add components to `src/ui/components/` and compose in `App.tsx`.

## Dependencies

| Package                          | Purpose                      |
| -------------------------------- | ---------------------------- |
| `@anthropic-ai/claude-agent-sdk` | Claude API with tool use     |
| `ink`                            | React renderer for terminals |
| `@inkjs/ui`                      | Terminal UI components       |
| `react`                          | Component framework          |

## Build & Distribution

- **Build**: tsup bundles TypeScript → ESM JavaScript
- **CLI**: `dist/cli.js` has shebang, registered in `package.json` bin
- **Library**: `dist/index.js` exports `run()`, types, and components
- **Package**: Only `dist/` ships (source not included)
