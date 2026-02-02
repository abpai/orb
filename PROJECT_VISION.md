# Voice-Driven Code Explorer

orb is a terminal-first assistant for exploring codebases. You can type questions or paste MacWhisper transcriptions, see tool calls live, and optionally hear answers spoken aloud via pocket-tts. The app keeps session context so follow-ups feel natural, and it supports Anthropic (Claude Agent SDK) and OpenAI (AI SDK + bash-tool) with quick model switching for Claude.

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
                    ┌─────────────────────┐
                    │     runAgent()      │
                    │ provider router     │
                    └─────────┬───────────┘
             ┌────────────────┴────────────────┐
             ▼                                 ▼
     Anthropic (Claude SDK)            OpenAI (AI SDK + bash-tool)
        Glob / Read / Grep / Bash       bash / readFile / writeFile
               (local tools)                (sandbox overlay)
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
- Maintains provider-specific session state (Claude session ID or OpenAI message history)
- Streams assistant text into the active response while buffering to avoid re-render thrash
- Coordinates streaming TTS (or batch TTS) and handles interrupts
- Allows model cycling with Shift+Tab for Anthropic models and shows the current model in the UI
- Switches between main view and transcript view (Ctrl+O)

### Terminal UI (`src/ui/components/`)

- **WelcomeSplash** + **OrbPanel**: startup display and animation
- **ActiveMessagePanel**: current question and streaming answer
- **CompletedEntry** + **ToolTree**: history of completed Q&A with tool calls
- **ResonanceBar**: status indicator, model label (provider-aware), and shortcuts
- **TranscriptViewer**: scrollable full conversation view
- **TTSErrorBanner**: non-blocking TTS errors

### Agent Integration (`src/services/agent/`)

- **Anthropic** (`anthropic.ts`): wraps `@anthropic-ai/claude-agent-sdk`, streams messages, tool calls, and session IDs
- **OpenAI** (`openai.ts`): uses the AI SDK `ToolLoopAgent` with `bash-tool` (`bash`/`readFile`/`writeFile`) in a sandbox overlay
- **Auth**: `openai-auth.ts` resolves API key vs ChatGPT OAuth and enforces Codex model limits

### TTS Services (`src/services/tts.ts`, `src/services/streaming-tts.ts`)

- **Server mode** (recommended): low latency via pocket-tts server
- **Generate mode**: CLI generation without a server
- Streaming controller buffers and chunks text (sentence + optional clause boundaries) before playback

## Configuration & Models

- Anthropic models are defined in `src/types/index.ts` with CLI aliases in `src/config.ts`
- Defaults: Haiku for Anthropic, `gpt-5.2-codex` for OpenAI
- During a session, press **Shift+Tab** to cycle Anthropic models
- ChatGPT OAuth limits OpenAI models to `gpt-5.2` and `gpt-5.2-codex`

## File Structure

```
src/
├── index.ts              # Entry point, renders App
├── cli.ts                # CLI wrapper
├── config.ts             # CLI parsing and defaults
├── services/
│   ├── agent/            # Anthropic/OpenAI runners
│   ├── openai-auth.ts    # OAuth + API key resolution
│   ├── auth-utils.ts     # Codex token helpers
│   ├── provider-defaults.ts # Smart provider detection
│   ├── session.ts        # Session persistence
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

- Anthropic + OpenAI providers with smart auto-selection (OAuth/API key)
- Typed input or MacWhisper paste
- Tool call visibility with live status updates
- Streaming answer display
- Optional streaming TTS (server or generate)
- Claude model cycling during a conversation
- Session persistence across restarts
- Transcript viewer for full history
- Interrupt handling (Esc / Ctrl+S)

## Near-Term Improvements

- Cross-platform audio playback
- Richer model picker UI (labels + tooltips)
- More discoverable shortcuts and in-app help
