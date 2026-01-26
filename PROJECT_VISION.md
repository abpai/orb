# Voice-Driven Code Explorer

vibe-claude is a terminal-first assistant for exploring codebases. You can type questions or paste MacWhisper transcriptions, see tool calls live, and optionally hear answers spoken aloud via pocket-tts. The app keeps session context so follow-ups feel natural, and it supports quick model switching mid-conversation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Terminal UI (Ink)                          │
├─────────────────────────────────────────────────────────────────┤
│  WelcomeSplash / OrbPanel / ActiveMessagePanel                  │
│  CompletedEntry history + ToolTree                              │
│  InputPrompt                                                    │
│  ResonanceBar (status + model)   TTSErrorBanner                 │
│  TranscriptViewer (Ctrl+O)                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Claude Agent SDK (streaming)
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
       Glob/Grep            Read               Bash
                              │
                              ▼
                    pocket-tts (streaming)
                              │
                              ▼
                        afplay (macOS)
```

## Design Principles

- **Conversation-first**: preserve session context across questions
- **Fast feedback**: stream answers and show tool calls immediately
- **Voice-friendly**: optionally speak answers, with streaming playback
- **Interruptible**: Esc or Ctrl+S cancels active runs and speech
- **Low-friction**: type or paste, no heavy setup required

## Core Components

### App Orchestration (`src/ui/App.tsx`)

- Tracks app state: `idle`, `processing`, `processing_speaking`, `speaking`
- Maintains session ID for multi-turn continuity
- Streams assistant text into the active response while buffering to avoid re-render thrash
- Coordinates streaming TTS (or batch TTS) and handles interrupts
- Allows model cycling with Shift+Tab and shows current model in the UI
- Switches between main view and transcript view (Ctrl+O)

### Terminal UI (`src/ui/components/`)

- **WelcomeSplash** + **OrbPanel**: startup display and animation
- **ActiveMessagePanel**: current question and streaming answer
- **CompletedEntry** + **ToolTree**: history of completed Q&A with tool calls
- **ResonanceBar**: status indicator and active model label
- **TranscriptViewer**: scrollable full conversation view
- **TTSErrorBanner**: non-blocking TTS errors

### Claude Agent Integration (`src/services/claude-agent.ts`)

- Wraps `@anthropic-ai/claude-agent-sdk` and streams messages
- Emits tool calls/results and assistant text via callbacks
- Stores session ID for future `resume`
- Passes `permissionMode` through to the SDK

### TTS Services (`src/services/tts.ts`, `src/services/streaming-tts.ts`)

- **Server mode** (recommended): low latency via pocket-tts server
- **Generate mode**: CLI generation without a server
- Streaming controller buffers sentences before playback

## Configuration & Models

- Models are defined in `src/types/index.ts` and CLI aliases in `src/config.ts`
- Default model is Haiku; use `--model=<haiku|sonnet|opus>` at startup
- During a session, press **Shift+Tab** to cycle models

## File Structure

```
src/
├── index.ts              # Entry point, renders App
├── cli.ts                # CLI wrapper
├── config.ts             # CLI parsing and defaults
├── services/
│   ├── claude-agent.ts   # Agent SDK wrapper
│   ├── tts.ts            # Batch TTS
│   └── streaming-tts.ts  # Streaming TTS controller
├── types/
│   └── index.ts          # Types, models, defaults
└── ui/
    ├── App.tsx           # Orchestration + state machine
    ├── components/       # UI components (Ink)
    ├── hooks/            # Animation and terminal sizing
    └── utils/            # Markdown + text helpers
```

## Current Capabilities

- Typed input or MacWhisper paste
- Tool call visibility with live status updates
- Streaming answer display
- Optional streaming TTS
- Model cycling during a conversation
- Session persistence across restarts
- Transcript viewer for full history
- Interrupt handling (Esc / Ctrl+S)

## Near-Term Improvements

- Cross-platform audio playback
- Richer model picker UI (labels + tooltips)
- More discoverable shortcuts and in-app help
