# Repository Guidelines

## Project Structure & Module Organization

- `src/index.ts` is the entry point for the Bun app.
- `src/ui/` contains the Ink/React UI. Components live in `src/ui/components/` and shared UI pieces in `src/ui/components/shared/`.
- `src/services/` holds integration logic (Claude agent and TTS helpers).
- `src/types/` contains shared TypeScript types.
- `src/config.ts` centralizes runtime configuration.

## Build, Test, and Development Commands

- `bun install` installs dependencies (commits `bun.lock`).
- `bun run dev` runs the app in watch mode for local development.
- `bun run start` runs the app once without watch mode.
- `bun run lint` checks code with ESLint.
- `bun run format` formats code with Prettier.
- `bun run typecheck` runs `tsc --noEmit`.
- `bun run test` executes Bun’s test runner.
- `bun run check` runs lint + typecheck.

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

- Copy `.env.example` to `.env` for local config; never commit secrets.
- Target Bun `>= 1.1.0` as specified in `package.json`.
