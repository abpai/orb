# #9 — Disentangle CLI parsing, help rendering, and config normalization in config.ts

**Severity:** Medium (structural)
**Status:** Deferred — a flag change currently has multiple local contracts to remember

## Problem

`src/config.ts` (535 lines) owns four distinct concerns in one file:

1. **Help rendering** — custom `buildHelpText`, section grouping, ANSI colour
   logic (lines 184-335)
2. **Commander option registration** — `.option(...)` calls that wire flags to
   Commander (lines 343-395)
3. **Explicit-flag tracking and parsed option types** — `ExplicitFlags`,
   `ParsedOpts` (lines 398-431)
4. **Runtime config normalization** — provider/model/voice/session resolution,
   default propagation (lines 442-533)

Adding or renaming a flag touches all four sections.

## Evidence

| Lines                   | Concern                              |
| ----------------------- | ------------------------------------ |
| `src/config.ts:184-335` | custom help renderer                 |
| `src/config.ts:343-395` | Commander option registration        |
| `src/config.ts:398-431` | explicit flags + parsed option types |
| `src/config.ts:442-533` | runtime config normalization         |

## Remediation direction

Define a **flag metadata array** — one entry per CLI flag:

```ts
interface FlagDescriptor {
  flags: string // '--voice <voice>'
  description: string
  section: 'common' | 'advanced'
  defaultValue?: unknown
  parser?: (value: string) => unknown
  applyToConfig?: (value: unknown, config: AppConfig, explicit: ExplicitFlags) => void
}
```

Derive:

- Commander `.option()` registration from `flags`, `description`, `defaultValue`, `parser`
- Help section grouping from `section`
- Config normalization from `applyToConfig`

This reduces a flag change to one descriptor entry. Split the resulting code
into `src/cli/program.ts` (Commander setup), `src/cli/help.ts` (help renderer),
and `src/config/resolve.ts` (normalization).
