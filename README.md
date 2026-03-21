# orb

Voice-driven code explorer powered by Anthropic (Claude) or OpenAI. Ask questions about your codebase, see tool calls live, and optionally hear answers spoken aloud.

## Features

- **Natural language queries** - Ask questions about your code in plain English
- **Voice input** - Paste transcriptions from MacWhisper for hands-free interaction
- **Text-to-speech** - Hear responses spoken aloud via `tts-gateway` in server mode or built-in macOS `say` in generate mode
- **Streaming TTS** - Speech begins while processing
- **Model switching (Claude)** - Cycle Anthropic models during a conversation with Shift+Tab
- **Provider selection** - Choose Anthropic (Claude) or OpenAI via CLI flags
- **Session persistence** - Automatically resumes the last session per project
- **Session continuity** - Follow-up questions maintain conversation context
- **Terminal UI** - Ink-based interface with live tool activity, orb animation, and focused conversation history

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
# Run without installing globally
bunx @andypai/orb

# Add to a Bun project
bun add @andypai/orb

# npm also works, but Bun is still required at runtime
npm install @andypai/orb
```

## Usage

```bash
# Explore current directory (uses smart default provider selection)
orb

# Guided setup for persistent defaults
orb setup

# Explore specific project
orb /path/to/project

# Anthropic with options
orb --model=sonnet --voice=marius
orb --provider=anthropic --model=opus

# OpenAI provider
orb --provider=openai --model=gpt-5.4
orb --model=openai:gpt-5.4  # shorthand syntax
```

### Options

| Option                   | Description                                                                    | Default                                 |
| ------------------------ | ------------------------------------------------------------------------------ | --------------------------------------- |
| `--provider=<provider>`  | LLM provider: `anthropic`\|`claude`, `openai`\|`gpt` (alias: `--llm-provider`) | `auto`                                  |
| `--voice=<voice>`        | TTS voice: `alba`, `marius`, `jean`                                            | `alba`                                  |
| `--tts-mode=<mode>`      | TTS mode: `generate`, `serve`                                                  | `serve`                                 |
| `--tts-server-url=<url>` | TTS gateway server URL                                                         | `http://localhost:8000`                 |
| `--tts-speed=<rate>`     | TTS speed multiplier                                                           | `1.5`                                   |
| `--model=<model>`        | Model ID or alias (`haiku`, `sonnet`, `opus`) or `provider:model`              | `haiku` (anthropic), `gpt-5.4` (openai) |
| `--new`                  | Start fresh (ignore saved session)                                             | -                                       |
| `--skip-intro`           | Skip the welcome animation                                                     | -                                       |
| `--no-tts`               | Disable text-to-speech                                                         | -                                       |
| `--no-streaming-tts`     | Disable streaming (batch mode)                                                 | -                                       |
| `--help`                 | Show help message                                                              | -                                       |

Sessions are stored under `~/.orb/sessions/` (one per project).

Persistent defaults live in `~/.orb/config.toml`. CLI flags override config values for one-off runs.

## Global Config

The easiest way to create `~/.orb/config.toml` is:

```bash
orb setup
```

Orb also supports editing the file directly. A typical config looks like:

```toml
provider = "anthropic"
model = "claude-haiku-4-5-20251001"
skip_intro = false

[tts]
enabled = true
streaming = true
mode = "serve"
server_url = "http://localhost:8000"
voice = "alba"
speed = 1.5
buffer_sentences = 1
clause_boundaries = false
min_chunk_length = 15
max_wait_ms = 150
grace_window_ms = 50
```

Config-only advanced tuning keys live under `[tts]`:

- `buffer_sentences`
- `clause_boundaries`
- `min_chunk_length`
- `max_wait_ms`
- `grace_window_ms`

## Customizing Prompts

Orb’s built-in instructions live in the root-level `prompts/` directory so they are easy to find and edit:

- `prompts/base.md` for shared behavior
- `prompts/anthropic.md` for Anthropic-specific system instructions
- `prompts/openai.md` for OpenAI-specific tool/sandbox instructions
- `prompts/voice.md` for voice-mode guidance added when TTS is enabled

Prompt files are read fresh for each run, so edits apply to the next question without rebuilding the app.

If you do not pass `--provider` or `--model`, orb auto-selects a provider in this order:

1. Claude Agent SDK (Claude Code / Max or API key)
2. `OPENAI_API_KEY`
3. `ANTHROPIC_API_KEY`

### Controls

- Type your question and press **Enter** to submit
- Paste MacWhisper transcription with **Cmd+V**
- Press **Esc** or **Ctrl+S** to stop speech
- Press **Shift+Tab** to cycle Claude models (Anthropic only)
- Press **Ctrl+O** to toggle live tool-call details
- Press **Ctrl+C** to exit

## Requirements

- **Runtime**: Bun >= 1.1 (Node runtime not supported)
- **LLM Provider**: Anthropic (Claude) or OpenAI authentication (see Provider Setup below)
- **TTS** (optional): [tts-gateway](https://github.com/abpai/tts-gateway) for server mode, or macOS built-in `say` and `afplay` for generate mode

## Provider Setup

orb supports two LLM providers: **Anthropic (Claude)** and **OpenAI**. Each provider has different authentication requirements and available models.

If you do not specify a provider, orb chooses the first available option in this order:

1. Claude Agent SDK (Claude Code / Max or API key)
2. `OPENAI_API_KEY`
3. `ANTHROPIC_API_KEY`

### Anthropic (Claude) - Default

Anthropic uses the Claude Agent SDK. Orb can reuse a local Claude Code / Max-authenticated session when available, or fall back to `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY`.

#### Quick Start

```bash
# Uses Anthropic by default
orb

# Explicitly specify Anthropic
orb --provider=anthropic

# Use model aliases
orb --model=haiku    # claude-haiku-4-5-20251001
orb --model=sonnet   # claude-sonnet-4-6
orb --model=opus     # claude-opus-4-6

# Use full model IDs
orb --model=claude-haiku-4-5-20251001
```

#### Available Models

- `claude-haiku-4-5-20251001` (default, alias: `haiku`) - Fast and efficient
- `claude-sonnet-4-6` (alias: `sonnet`) - Best combination of speed and intelligence
- `claude-opus-4-6` (alias: `opus`) - Most capable model for complex reasoning and coding

#### Authentication

Anthropic uses the Claude Agent SDK for authentication. If you are not already signed in through Claude Code / Max, set `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` before starting Orb.

For setup details, see the [Claude Agent SDK quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart) and the [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview).

### OpenAI

OpenAI support uses the official OpenAI Responses API and requires `OPENAI_API_KEY`.

#### Quick Start with API Key

```bash
# Set your API key
export OPENAI_API_KEY=sk-...

# Run with OpenAI provider
orb --provider=openai

# Specify a model
orb --provider=openai --model=gpt-5.4

# Or use the provider:model shorthand
orb --model=openai:gpt-5.4
```

#### Available Models

With an API key, any supported OpenAI model ID can be used. Common current examples include:

- `gpt-5.4` (default for OpenAI)
- `gpt-5`
- `gpt-4o`
- `gpt-5.4-mini`

> **Note**: OpenAI runs in a sandboxed environment via `bash-tool`. File edits happen in a sandbox overlay and are **not** applied to your actual repository. The assistant will describe any changes it makes, and you can apply them manually.

## TTS Setup

orb supports two TTS paths:

- **Server mode** (default): send speech requests to a local `tts-gateway` server
- **Generate mode**: use built-in macOS `say` for local fallback speech

> Note: generate mode and audio playback use macOS built-ins (`say` and `afplay`). For other platforms, use serve mode with `tts-gateway` or run with `--no-tts`.

### Server mode (recommended)

Start `tts-gateway` for low-latency speech generation:

```bash
uv tool install tts-gateway[kokoro]
tts serve --provider kokoro --port 8000
```

Then run orb with default settings (uses server mode automatically).

If you already run `tts-gateway` under PM2, point Orb at that URL with `--tts-server-url`.
If you always use a non-localhost TTS server, set `tts.server_url` in `~/.orb/config.toml` or run `orb setup`.

`tts-gateway` can use different engines behind the same `POST /tts` API.

### Generate mode

On macOS, generate mode works out of the box with the built-in `say` command.

Then run:

```bash
orb --tts-mode=generate
```

If you want advanced voices or non-macOS support, use server mode with `tts-gateway` instead.

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
bun run dev --provider=openai --model=gpt-5.4

# Run checks
bun run check    # prettier + test
bun run test     # run tests
```

## License

MIT
