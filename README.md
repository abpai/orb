# orb

Voice-driven code explorer powered by Anthropic (Claude) or OpenAI. Ask questions about your codebase, see tool calls live, and optionally hear answers spoken aloud.

## Features

- **Natural language queries** - Ask questions about your code in plain English
- **Voice input** - Paste transcriptions from MacWhisper for hands-free interaction
- **Text-to-speech** - Hear responses spoken aloud via pocket-tts (server or generate mode)
- **Streaming TTS** - Speech begins while processing
- **Model switching (Claude)** - Cycle Anthropic models during a conversation with Shift+Tab
- **Provider selection** - Choose Anthropic (Claude) or OpenAI via CLI flags
- **Session persistence** - Automatically resumes the last session per project
- **Session continuity** - Follow-up questions maintain conversation context
- **Terminal UI** - Ink-based interface with tool call visualization, orb animation, and transcript view

## Installation

### Global install (recommended)

```bash
# With bun
bun install -g @andypai/orb

# With npm (requires Bun at runtime)
npm install -g @andypai/orb
```

### Local install

```bash
npm install @andypai/orb
```

## Usage

```bash
# Explore current directory (uses smart default provider selection)
orb

# Explore specific project
orb /path/to/project

# Anthropic with options
orb --model=sonnet --voice=marius
orb --provider=anthropic --model=opus

# OpenAI provider
orb --provider=openai --model=gpt-4o
orb --model=openai:gpt-4o  # shorthand syntax
```

### Options

| Option                           | Description                                                                    | Default                                 |
| -------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| `--provider=<provider>`          | LLM provider: `anthropic`\|`claude`, `openai`\|`gpt` (alias: `--llm-provider`) | `auto`                                  |
| `--voice=<voice>`                | TTS voice: `alba`, `marius`, `jean`                                            | `alba`                                  |
| `--tts-mode=<mode>`              | TTS mode: `generate`, `serve`                                                  | `serve`                                 |
| `--tts-server-url=<url>`         | Pocket TTS server URL                                                          | `http://localhost:8000`                 |
| `--tts-speed=<rate>`             | TTS speed multiplier                                                           | `1.5`                                   |
| `--tts-buffer-sentences=<count>` | Sentences to buffer before playback                                            | `1` (OpenAI: `3`)                       |
| `--tts-clause-boundaries`        | Enable comma/semicolon/colon split points                                      | `off` (OpenAI: `on`)                    |
| `--tts-min-chunk-length=<count>` | Minimum chars before soft flush                                                | `15` (OpenAI: `60`)                     |
| `--tts-max-wait-ms=<ms>`         | Max latency before forcing a flush                                             | `150` (OpenAI: `600`)                   |
| `--tts-grace-window-ms=<ms>`     | Extra wait when near a boundary                                                | `50` (OpenAI: `200`)                    |
| `--model=<model>`                | Model ID or alias (`haiku`, `sonnet`, `opus`) or `provider:model`              | `haiku` (anthropic), `gpt-5.2-codex` (openai) |
| `--openai-login`                 | Run OpenAI browser login (requires `codex`)                                    | -                                       |
| `--openai-device-login`          | Run OpenAI device login (requires `codex`)                                     | -                                       |
| `--openai-api=<api>`             | OpenAI API mode: `responses` or `chat`                                         | `responses`                             |
| `--new`                          | Start fresh (ignore saved session)                                             | -                                       |
| `--no-tts`                       | Disable text-to-speech                                                         | -                                       |
| `--no-streaming-tts`             | Disable streaming (batch mode)                                                 | -                                       |
| `--help`                         | Show help message                                                              | -                                       |

Sessions are stored under `~/.orb/sessions/` (one per project).

If you do not pass `--provider` or `--model`, orb auto-selects a provider in this order:

1. Claude Agent SDK (OAuth / Max subscription)
2. OpenAI OAuth (via `codex` CLI)
3. `OPENAI_API_KEY`
4. `ANTHROPIC_API_KEY`

### Controls

- Type your question and press **Enter** to submit
- Paste MacWhisper transcription with **Cmd+V**
- Press **Esc** or **Ctrl+S** to stop speech
- Press **Shift+Tab** to cycle Claude models (Anthropic only)
- Press **Ctrl+O** to open the transcript viewer
- Press **Ctrl+C** to exit

## Requirements

- **Runtime**: Bun >= 1.1 (Node runtime not supported)
- **LLM Provider**: Anthropic (Claude) or OpenAI authentication (see Provider Setup below)
- **TTS** (optional): [pocket-tts](https://github.com/nicholasgriffintn/pocket-tts) + macOS `afplay`

## Provider Setup

orb supports two LLM providers: **Anthropic (Claude)** and **OpenAI**. Each provider has different authentication requirements and available models.

If you do not specify a provider, orb chooses the first available option in this order:

1. Claude Agent SDK (OAuth / Max subscription)
2. OpenAI OAuth (via `codex` CLI)
3. `OPENAI_API_KEY`
4. `ANTHROPIC_API_KEY`

### Anthropic (Claude) - Default

Anthropic uses the Claude Agent SDK for authentication. No additional setup is required if you're already authenticated with the Claude Agent SDK. You can also set `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` for API-key auth.

#### Quick Start

```bash
# Uses Anthropic by default
orb

# Explicitly specify Anthropic
orb --provider=anthropic

# Use model aliases
orb --model=haiku    # claude-haiku-4-5-20251001
orb --model=sonnet   # claude-sonnet-4-5-20250929
orb --model=opus     # claude-opus-4-20250514

# Use full model IDs
orb --model=claude-haiku-4-5-20251001
```

#### Available Models

- `claude-haiku-4-5-20251001` (default, alias: `haiku`) - Fast and efficient
- `claude-sonnet-4-5-20250929` (alias: `sonnet`) - Balanced performance
- `claude-opus-4-20250514` (alias: `opus`) - Most capable

#### Authentication

Anthropic uses the Claude Agent SDK for authentication. Ensure you're authenticated:

```bash
# Check if authenticated (if using Anthropic CLI)
anthropic auth status
```

If not authenticated, follow the [Claude Agent SDK setup guide](https://docs.anthropic.com/claude/docs/agents-quickstart).

### OpenAI

OpenAI support requires either an API key or OAuth authentication via the `codex` CLI.

#### Quick Start with API Key

```bash
# Set your API key
export OPENAI_API_KEY=sk-...

# Run with OpenAI provider
orb --provider=openai

# Specify a model
orb --provider=openai --model=gpt-4o

# Or use the provider:model shorthand
orb --model=openai:gpt-4o
```

#### Available Models

With an API key, any OpenAI model ID can be used. Common options include:

- `gpt-5.2-codex` (default for OpenAI)
- `gpt-5.2`
- `gpt-4o`
- `gpt-4-turbo`
- `o1-preview`
- `o1-mini`

If you authenticate via ChatGPT OAuth (codex CLI), model selection is limited to `gpt-5.2` and `gpt-5.2-codex`.

#### OpenAI OAuth (ChatGPT Login)

If you want to use a ChatGPT subscription instead of an API key, authenticate via the official `codex` CLI:

```bash
# Install codex CLI
npm install -g @openai/codex

# Login (browser-based)
codex login

# Or trigger login directly from orb
orb --openai-login --provider=openai

# For device-based auth
orb --openai-device-login --provider=openai

# Then run normally
orb --provider=openai
```

> **Note**: ChatGPT OAuth currently supports only `gpt-5.2` and `gpt-5.2-codex`. Use `OPENAI_API_KEY` for other models.

#### API Mode

If you encounter a missing `api.responses.write` scope error, either update your API key permissions or run in chat mode:

```bash
orb --provider=openai --openai-api=chat
```

> **Note**: When using ChatGPT OAuth, orb always uses the chat API regardless of `--openai-api`.

> **Note**: OpenAI runs in a sandboxed environment via `bash-tool`. File edits happen in a sandbox overlay and are **not** applied to your actual repository. The assistant will describe any changes it makes, and you can apply them manually.

## TTS Setup

orb uses pocket-tts for text-to-speech. Install it via pip:

```bash
pip install pocket-tts
```

> Note: audio playback uses macOS `afplay`. For other platforms, run with `--no-tts`.

### Server mode (recommended)

Start the pocket-tts server for faster speech generation:

```bash
pocket-tts serve --port 8000
```

Then run orb with default settings (uses server mode automatically).

### Generate mode

For CLI-based generation without a server:

```bash
orb --tts-mode=generate
```

### Disable TTS

To use orb without speech:

```bash
orb --no-tts
```

## Example Session

```
╭──────────────────────────────────────────────────────────╮
│                           orb                            │
│                                                          │
│ Project: my-app                                          │
│ Path: /Users/dev/my-app                                  │
│ Provider: anthropic                                      │
│ Model: claude-haiku-4-5-20251001                         │
│ TTS: alba, server, x1.5                                  │
│ TTS URL: http://localhost:8000                           │
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

[Uses session context to understand "config parsing" refers
to the project you're exploring, not its own implementation]
```

## Development

```bash
# Clone and install
git clone https://github.com/andypai/orb.git
cd orb
bun install

# Run in development (Anthropic by default)
bun run dev

# Run with OpenAI provider
bun run dev --provider=openai --model=gpt-4o

# Build for production
bun run build

# Run checks
bun run check    # lint + typecheck
bun run test     # run tests
```

## License

MIT
