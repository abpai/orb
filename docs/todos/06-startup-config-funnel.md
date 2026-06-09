# #6 — Replace procedural startup config funnel with a pure resolver

**Severity:** Medium-High (structural)
**Status:** Deferred — no correctness issue today; ordering sensitivity will compound

## Problem

`run()` in `src/index.ts` resolves configuration through a long sequence of
imperative mutations in a fixed order:

1. Load global config, parse CLI args (lines 106-115)
2. Mutate for resume-by-id (lines 120-128) — **also calls `process.exit(1)`**
3. Mutate provider/model after credential discovery (lines 131-144) — **also
   calls `process.exit(1)`**
4. Resolve model catalog, mutate model choices (lines 145-151)
5. Apply provider-specific TTS defaults (line 152)
6. Load sessions and external resume metadata (lines 153-169)

Correctness depends on the ordering of these side effects. A new provider, a
new config source, or a new resume mode requires threading another mutation into
the sequence at the right position. `process.exit` embedded in the middle makes
testing the resolution logic difficult.

## Evidence

| Lines                  | What happens                                          |
| ---------------------- | ----------------------------------------------------- |
| `src/index.ts:106-115` | global config load + CLI parse                        |
| `src/index.ts:120-128` | resume-by-id mutation + `process.exit(1)`             |
| `src/index.ts:131-144` | smart-provider detection mutation + `process.exit(1)` |
| `src/index.ts:145-151` | model-catalog mutation                                |
| `src/index.ts:152`     | OpenAI streaming defaults mutation                    |
| `src/index.ts:153-169` | session load and resume metadata                      |

## Remediation direction

Extract a pure `resolveRuntimeConfig(rawArgs): Promise<RuntimeConfig | StartupError>`
function (or return a discriminated union) that:

- accepts raw CLI args and returns a fully-resolved config, session, and resume
  info, **or** a structured `StartupError` with a message and exit code
- contains no `process.exit` calls
- has no side effects beyond I/O

`run()` becomes a thin shell:

```ts
const result = await resolveRuntimeConfig(args)
if (result.kind === 'error') { console.error(result.message); process.exit(result.code) }
render(<App {...result} />)
```

This makes the startup logic unit-testable without process-exit mocking.
