# Bun Boilerplate

Minimal Bun project starter with:

- Bun runtime + test runner
- TypeScript out of the box
- ESLint (flat config) + Prettier wired together
- Simple scripts for dev/lint/format/test/typecheck

## Quick start

```bash
bun install
bun run dev
```

## Scripts

```bash
bun run dev        # run with watch mode
bun run start      # run once
bun run lint       # eslint
bun run format     # prettier write
bun run typecheck  # tsc --noEmit
bun run test       # bun test
bun run check      # lint + typecheck
```

## Project layout

- `src/index.ts` – entry point (prints Hello, world!)
- `eslint.config.js` – Bun + TS aware linting
- `.prettierrc` – formatting rules

## Notes

- After `bun install`, Bun will create `bun.lockb` (recommended to commit).
