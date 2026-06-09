# #15 — Split external session discovery into per-vendor source modules

**Severity:** Medium (structural)
**Status:** Deferred — next external provider will be a bolt-on branch without this

## Problem

`src/services/external-sessions.ts` (543 lines) mixes two vendor-specific
implementations with different storage contracts, freshness policies, and cost profiles:

- **Claude Code discovery**: path/index/jsonl logic, lines 91-285
- **Codex discovery**: date-tree scanning with up to 2000 files (lines 19-20,
  465-470), sequential processing of rollout files (lines 470-479), full
  line-by-line split per match (lines 420-444)

Adding a third external source (e.g. Gemini CLI) means adding another branch
rather than implementing a shared interface. The Codex scan's 2000-file default
and sequential processing make it the most expensive startup path.

## Evidence

| Lines                                       | Concern                        |
| ------------------------------------------- | ------------------------------ |
| `src/services/external-sessions.ts:9-17`    | single module for both vendors |
| `src/services/external-sessions.ts:91-285`  | Claude-specific logic          |
| `src/services/external-sessions.ts:289-527` | Codex-specific date-tree scan  |
| `src/services/external-sessions.ts:19-20`   | `MAX_CODEX_FILES = 2000`       |
| `src/services/external-sessions.ts:465-470` | sequential file walk           |
| `src/services/external-sessions.ts:470-479` | sequential rollout processing  |

## Remediation direction

Define a `SessionSource` interface:

```ts
interface SessionSource {
  name: string
  findSession(id: string, projectPath: string): Promise<ExternalSessionMeta | null>
}
```

Move Claude Code logic to `src/services/external-sessions/claude.ts` and Codex
logic to `src/services/external-sessions/codex.ts`. The top-level module
becomes a registry that tries each source in order.

For Codex performance: use a date-index or provider-level index file instead of
walking up to 2000 files; or at minimum use bounded concurrency (e.g.
`p-limit(4)`) on the rollout reads.
