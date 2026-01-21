# Voice-Driven Code Explorer

A voice assistant that lets you ask questions about your codebase using MacWhisper (speech-to-text) or keyboard, get answers from Claude via the Agent SDK, and hear responses via pocket-tts.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Terminal UI (Ink)                          │
├─────────────────────────────────────────────────────────────────┤
│  [Status: Listening]                                            │
│                                                                 │
│  ────────────── Tool Calls ──────────────                       │
│  ✓ Glob: **/*.ts                                               │
│  ✓ Read: src/index.ts                                          │
│  ⠋ Grep: "function" in src/                                    │
│                                                                 │
│  ────────────── Response ──────────────                         │
│  The codebase has 12 TypeScript files...                       │
│                                                                 │
│  ────────────── Input ──────────────                            │
│  > [type or paste MacWhisper transcription here]               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Claude Agent SDK (streaming)
                              │
                              ▼
                    pocket-tts → afplay (speaker)
```

## Design Decisions

- **Continuous mode**: Conversations persist across questions (session memory)
- **Terminal input**: Type or paste from MacWhisper (Cmd+V after transcription)
- **Detailed responses**: Thorough explanations read aloud

## Core Components

### 1. Terminal Input (`src/ui/components/InputField.tsx`)

- Ink `TextInput` component for typing/pasting
- Submit on Enter → triggers agent query
- Disabled while processing/speaking

### 2. Claude Agent (`src/services/claude-agent.ts`)

- Use `@anthropic-ai/claude-agent-sdk` with streaming
- Tools: `Read`, `Grep`, `Glob`, `Bash` (read-only via `canUseTool`)
- Emit events: `onToolCall`, `onToolResult`, `onAssistantText`

### 3. TTS Output (`src/services/tts.ts`)

- CLI mode: `pocket-tts generate --text "..." --voice alba`
- Play via `afplay` (macOS built-in)
- Chunk long text at sentence boundaries for streaming feel

### 4. Terminal UI (`src/ui/`)

- **Ink** (React for terminals) with `@inkjs/ui` components
- StatusBar: current state (listening/processing/speaking)
- ToolPanel: static log of tool calls
- ResponsePanel: Claude's answer (what's being spoken)

## File Structure

```
src/
├── index.ts              # CLI entry point
├── config.ts             # Configuration types
├── services/
│   ├── claude-agent.ts   # Agent SDK wrapper
│   └── tts.ts            # pocket-tts integration
├── ui/
│   ├── App.tsx           # Root Ink component + state
│   └── components/
│       ├── StatusBar.tsx
│       ├── ToolPanel.tsx
│       ├── ResponsePanel.tsx
│       └── InputField.tsx
└── types/
    └── index.ts          # Shared types
```

## Key Implementation Details

### Main UI Flow (App.tsx)

```tsx
function App({ config }: { config: AppConfig }) {
  const [state, setState] = useState<'idle' | 'processing' | 'speaking'>('idle')
  const [input, setInput] = useState('')
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
  const [response, setResponse] = useState('')
  const sessionIdRef = useRef<string>()
  const toolIndexRef = useRef(0)

  const handleSubmit = async (query: string) => {
    setState('processing')
    setToolCalls([])
    setResponse('')
    toolIndexRef.current = 0

    const result = await runAgent(query, {
      workingDirectory: config.projectPath,
      resume: sessionIdRef.current, // Continue conversation
      permissionMode: 'default',
      maxBudgetUsd: config.maxBudgetUsd, // Optional cost control
      onMessage: (message) => {
        switch (message.type) {
          case 'system':
            // Capture session_id from init message for resume
            if (message.subtype === 'init') {
              sessionIdRef.current = message.session_id
            }
            break

          case 'tool_call':
            // Track by index, not name (handles duplicate tool names)
            const callIndex = toolIndexRef.current++
            setToolCalls((t) => [
              ...t,
              {
                index: callIndex,
                name: message.tool_name,
                input: message.input,
                status: 'running',
              },
            ])
            break

          case 'tool_result':
            // Update by matching index (passed through tool_result)
            setToolCalls((t) =>
              t.map((c, i) =>
                i === t.length - 1 ? { ...c, status: 'complete', result: message.result } : c,
              ),
            )
            break

          case 'assistant':
            // Handle both string and block formats
            const text =
              typeof message.content === 'string'
                ? message.content
                : message.content
                    .filter((b) => b.type === 'text')
                    .map((b) => b.text)
                    .join('')
            setResponse(text)
            break
        }
      },
    })

    setState('speaking')
    await speak(result)
    setState('idle')
    setInput('')
  }

  return (
    <Box flexDirection="column">
      <StatusBar status={state} />
      <ToolPanel calls={toolCalls} />
      <ResponsePanel text={response} />
      <InputField
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={state !== 'idle'}
      />
    </Box>
  )
}
```

### Agent Restrictions (read-only)

```typescript
// Allowlist of safe read-only commands
const SAFE_BASH_PREFIXES = [
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'file',
  'stat',
  'pwd',
  'echo',
]
const DESTRUCTIVE_PATTERNS = [/\brm\s+-rf?\b/, /\bsudo\b/, />\s*\//, /\bmkdir\b/, /\bchmod\b/]

canUseTool: async (toolName, input) => {
  if (['Edit', 'Write', 'NotebookEdit'].includes(toolName)) {
    return { behavior: 'deny', message: 'Read-only mode' }
  }

  if (toolName === 'Bash') {
    const cmd = (input as { command: string }).command.trim()

    // Deny obviously destructive patterns
    if (DESTRUCTIVE_PATTERNS.some((p) => p.test(cmd))) {
      return { behavior: 'deny', message: 'Destructive command blocked' }
    }

    // For anything not in safe list, ask user
    const firstWord = cmd.split(/\s+/)[0]
    if (!SAFE_BASH_PREFIXES.includes(firstWord)) {
      return { behavior: 'ask', message: `Allow "${cmd.slice(0, 50)}..."?` }
    }
  }

  return { behavior: 'allow' }
}
```

## Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "ink": "^5.0.1",
    "@inkjs/ui": "^2.0.0",
    "react": "^18.3.1"
  }
}
```

## Configuration (`src/config.ts`)

```typescript
interface AppConfig {
  // Claude Agent SDK options
  projectPath: string // workingDirectory for agent (default: cwd)
  permissionMode: 'default' // Permission handling mode
  maxBudgetUsd?: number // Optional cost control (e.g., 0.50)
  model: 'claude-sonnet-4-5' | 'claude-opus-4'

  // TTS options
  ttsVoice: 'alba' | 'marius' | 'jean' // pocket-tts voice
  ttsMode: 'cli' | 'server' // CLI vs server mode
}

// CLI args: bun dev [projectPath] --budget=0.50 --voice=alba
```

## Implementation Phases

### Phase 1: Minimal Pipeline

1. Install dependencies (ink, claude-agent-sdk, react)
2. Basic Ink app with TextInput
3. Claude Agent query with console.log output
4. TTS via CLI mode (pocket-tts + afplay)
5. Test end-to-end: type → query → speak

### Phase 2: Terminal UI

6. StatusBar component (idle/processing/speaking)
7. ToolPanel with Static (append-only tool call log)
8. ResponsePanel (streaming text display)
9. Wire all components together

### Phase 3: Polish

10. Session continuity (capture/resume session_id)
11. Error handling & graceful degradation
12. Configuration via CLI args

## Verification

1. **Input**: Run `bun dev`, type/paste question → query sent
2. **Tool Calls**: Ask "what files are in src/" → see ToolPanel populate
3. **Response**: See Claude's response in ResponsePanel
4. **TTS**: Hear detailed explanation read aloud
5. **Continuous**: Ask follow-up "what does the main one do?" → uses context

## Prerequisites

- pocket-tts installed: `pip install pocket-tts` or build from source
- `ANTHROPIC_API_KEY` environment variable set
- MacWhisper (optional): Configure to copy transcription to clipboard for easy paste

## Usage

```bash
# Start the assistant
bun dev

# In terminal:
# - Type question OR paste MacWhisper transcription
# - Press Enter to submit
# - Watch tool calls, see response, hear it spoken
# - Ask follow-up questions (conversation persists)
# - Ctrl+C to exit
```

---

## Future Roadmap (After Initial Implementation)

### Streaming TTS

- Start speaking incrementally as assistant text arrives (after small buffer)
- Adds "live assistant" feel and reduces perceived latency
- Chunk on sentence boundaries for natural speech flow

### Interrupt & Skip

- Press Esc or Ctrl+S to stop current speech immediately
- Kill `afplay` process and return to input
- Useful for long responses or when you have a follow-up

### Enhanced Tool Display

- Show "current tool" line with spinner and duration timer
- Push completed tool calls into collapsible history
- Vocalize tool activity: "Hmm, let me search these files..."

### Input Affordances

- "Paste & Enter" hint for MacWhisper workflow
- Timestamped transcript history for quick reuse
- "Last query" hotkey (↑ arrow or similar)

### Visual Polish

- Distinct typography via Ink styles (bold headers, dim metadata)
- Gradient or panel borders for section separation
- Clear distinction between "streaming" and "final" response

### Audio Cues

- Short earcons for state changes (listening → processing → speaking)
- Volume and speed toggles
- Optional voice selection for TTS
