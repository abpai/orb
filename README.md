# vibe-claude

Voice-driven code explorer powered by Claude Agent SDK. Ask questions about your codebase, hear detailed explanations read aloud.

## Features

- **Natural language queries** - Ask questions about your code in plain English
- **Voice input** - Paste transcriptions from MacWhisper for hands-free interaction
- **Text-to-speech** - Hear responses spoken aloud via pocket-tts
- **Streaming TTS** - Speech begins while Claude is still processing
- **Read-only safety** - Claude can explore but not modify your code
- **Session continuity** - Follow-up questions maintain conversation context
- **Terminal UI** - Beautiful Ink-based interface with tool call visualization

## Installation

### Global install (recommended)

```bash
# With npm
npm install -g @andypai/vibe-claude

# With bun
bun install -g @andypai/vibe-claude
```

### Local install

```bash
npm install @andypai/vibe-claude
```

## Usage

```bash
# Explore current directory
vibe-claude

# Explore specific project
vibe-claude /path/to/project

# With options
vibe-claude --model=sonnet --voice=marius --budget=1.00
```

### Options

| Option                   | Description                         | Default                 |
| ------------------------ | ----------------------------------- | ----------------------- |
| `--budget=<amount>`      | Max budget in USD (e.g., `0.50`)    | none                    |
| `--voice=<voice>`        | TTS voice: `alba`, `marius`, `jean` | `alba`                  |
| `--tts-mode=<mode>`      | TTS mode: `generate`, `serve`       | `serve`                 |
| `--tts-server-url=<url>` | Pocket TTS server URL               | `http://localhost:8000` |
| `--tts-speed=<rate>`     | TTS speed multiplier                | `1.5`                   |
| `--tts-buffer-sentences=<count>` | Sentences to buffer before playback | `1`               |
| `--model=<model>`        | Model: `haiku`, `sonnet`, `opus`    | `haiku`                 |
| `--no-tts`               | Disable text-to-speech              | -                       |
| `--no-streaming-tts`     | Disable streaming (batch mode)      | -                       |
| `--help`                 | Show help message                   | -                       |

### Controls

- Type your question and press **Enter** to submit
- Paste MacWhisper transcription with **Cmd+V**
- Press **Esc** or **Ctrl+S** to stop speech
- Press **Ctrl+C** to exit

## Requirements

- **Runtime**: Node.js >= 20 or Bun >= 1.1
- **API Key**: `ANTHROPIC_API_KEY` environment variable
- **TTS** (optional): [pocket-tts](https://github.com/nicholasgriffintn/pocket-tts) + macOS `afplay`

## TTS Setup

vibe-claude uses pocket-tts for text-to-speech. Install it via pip:

```bash
pip install pocket-tts
```

### Server mode (recommended)

Start the pocket-tts server for faster speech generation:

```bash
pocket-tts serve --port 8000
```

Then run vibe-claude with default settings (uses server mode automatically).

### Generate mode

For CLI-based generation without a server:

```bash
vibe-claude --tts-mode=generate
```

### Disable TTS

To use vibe-claude without speech:

```bash
vibe-claude --no-tts
```

## Example Session

```
╭──────────────────────────────────────────────────────────╮
│                       vibe-claude                        │
│                                                          │
│ Project: my-app                                          │
│ Path: /Users/dev/my-app                                  │
│ Model: claude-haiku-4-5-20251001                         │
│ Budget: $0.50                                            │
│ TTS: alba, server, x1.5                                  │
╰──────────────────────────────────────────────────────────╯

> What's the main entry point of this project?

─── Tool Calls ───────────────────────────────
✓ Glob: package.json
✓ Read: package.json
✓ Read: src/index.ts

─── Response ─────────────────────────────────
The main entry point is src/index.ts. It exports a run() function
that parses CLI arguments and renders the React/Ink application...

> Tell me more about how config parsing works

[Claude uses session context to understand "config parsing" refers
to the project you're exploring, not its own implementation]
```

## Development

```bash
# Clone and install
git clone https://github.com/andypai/vibe-claude.git
cd vibe-claude
bun install

# Run in development
bun run dev

# Build for production
bun run build

# Run checks
bun run check    # lint + typecheck
bun run test     # run tests
```

## License

MIT
