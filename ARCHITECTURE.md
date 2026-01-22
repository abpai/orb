# Architecture

vibe-claude is a voice-driven code explorer built with the Claude Agent SDK, Ink (React for terminals), and pocket-tts.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Terminal UI (Ink)                          │
├─────────────────────────────────────────────────────────────────┤
│  WelcomeSplash       ConversationPanel       InputPrompt        │
│  (config display)    (Q&A + tool calls)      (user input)       │
│                                                                 │
│  ResonanceBar        TTSErrorBanner                             │
│  (status + wave)     (error notifications)                      │
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
    │   Grep   │        │          │        │(filtered)│
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
│   ├── claude-agent.ts   # Claude SDK wrapper with safety restrictions
│   ├── tts.ts            # Text-to-speech (batch mode)
│   └── streaming-tts.ts  # Streaming TTS controller
└── ui/
    ├── App.tsx           # Root component, state management
    ├── components/
    │   ├── ConversationPanel.tsx  # Q&A history + tool calls
    │   ├── InputPrompt.tsx        # User input with cursor
    │   ├── ResonanceBar.tsx       # Status with wave animation
    │   ├── TTSErrorBanner.tsx     # Error notifications
    │   └── WelcomeSplash.tsx      # Startup config display
    └── utils/
        └── markdown.ts   # Markdown → speech text conversion
```

## Data Flow

### Request Lifecycle

1. **User Input** → `InputPrompt` captures text, triggers `handleSubmit`
2. **State: processing** → App disables input, shows "thinking" indicator
3. **Claude Query** → `runAgent()` streams messages from Claude Agent SDK
4. **Tool Execution** → Claude calls Glob/Read/Grep/Bash, results stream back
5. **Assistant Text** → Text chunks stream to `ConversationPanel` and TTS
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

**Tool Allowlist:**

- `Glob` - Find files by pattern
- `Read` - Read file contents
- `Grep` - Search file contents with regex
- `Bash` - Execute shell commands (heavily filtered)

**Tool Blocklist:**

- `Edit`, `Write`, `NotebookEdit`, `TodoWrite` - All write operations

**Bash Command Filtering:**

Three layers of protection:

1. **Safe command allowlist** - 50+ read-only commands (ls, cat, grep, find, git status, etc.)
2. **Destructive pattern blocklist** - rm, sudo, shell redirects, mkdir, chmod, mv, cp, touch, ln
3. **Default deny** - Unknown commands are rejected

```typescript
// Example: allowed
'ls -la' // ✓ First word in SAFE_READ_COMMANDS
'git status' // ✓ Prefix matches SAFE_GIT_COMMANDS
'grep -r "TODO"' // ✓ First word is 'grep'

// Example: denied
'rm -rf /' // ✗ Matches DESTRUCTIVE_PATTERNS
'echo "hi" > file' // ✗ Shell redirect detected
'npm install' // ✗ Not in safe list
```

### Terminal UI (`src/ui/`)

Built with **Ink** (React for terminals) and **@inkjs/ui** components.

**Component Hierarchy:**

```
App
├── WelcomeSplash (shown once on startup)
├── ConversationPanel
│   └── HistoryEntry (for each Q&A pair)
│       ├── Question box
│       ├── Tool call tree (collapsible)
│       └── Answer box
├── ResonanceBar (status + wave animation)
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
  maxBudgetUsd?: number // Optional cost control
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
vibe-claude --model=sonnet --budget=1.00 --voice=marius
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

### Adding New Tools

1. Add to `ALLOWED_TOOLS` array in `claude-agent.ts`
2. Tool will be available to Claude automatically
3. For Bash variants, add to `SAFE_READ_COMMANDS` or `SAFE_GIT_COMMANDS`

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
