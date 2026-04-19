# Repository Guidelines

## Project Structure & Module Organization

- `src/cli.ts` is the Bun CLI entry point.
- `src/index.ts` wires CLI config into the Ink app runtime.
- `src/ui/` contains the Ink/React UI. Components live in `src/ui/components/`, hooks in `src/ui/hooks/`, and the multiline editor/input logic in `src/ui/input/`.
- `src/pipeline/` holds the runtime frame pipeline, provider adapters, OpenAI tools, and sandbox implementations.
- `src/services/` holds supporting integration logic such as auth, prompts, sessions, config, and TTS helpers.
- `src/types/` contains shared TypeScript types.
- `src/config.ts` centralizes runtime configuration.

## Build, Test, and Development Commands

- `bun install` installs dependencies (commits `bun.lock`).
- `bun run dev` runs the app in watch mode for local development.
- `bun run start` runs the app once without watch mode.
- `bun run format` formats code with Prettier.
- `bun run typecheck` runs the TypeScript compiler without emitting files.
- `bun run test` executes Bun’s test runner.
- `bun run check` runs Prettier checks + typecheck + test.

## Coding Style & Naming Conventions

- TypeScript with ES modules (`"type": "module"` in `package.json`).
- Indentation: 2 spaces; no tabs. Newlines are LF.
- Prettier settings: no semicolons, single quotes, print width 100.
- Component files use PascalCase (e.g., `ActiveMessagePanel.tsx`).
- Utility files use lower camel or descriptive names (e.g., `markdown.ts`).

## Testing Guidelines

- Uses Bun’s built-in test runner (`bun test`).
- There is no dedicated test directory yet; when adding tests, follow Bun’s default discovery patterns (e.g., `*.test.ts` or `*.spec.ts`) and keep tests close to the code they cover.

## Commit & Pull Request Guidelines

- Commit messages follow Conventional Commits (examples from history: `feat:`, `docs:`, `chore(scope):`).
- PRs should include a short summary, testing steps (e.g., `bun run test`), and screenshots or terminal output for UI changes.

## Security & Configuration Tips

- Configure secrets via shell environment variables like `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `CLAUDE_API_KEY`; never commit secrets.
- Persistent user defaults live in `~/.orb/config.toml` and can be created with `orb setup`.
- Target Bun `>= 1.1.0` as specified in `package.json`.
