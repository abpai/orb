# #13 — Split session persistence and fix silent provider coercion

**Severity:** Medium (structural + correctness risk)
**Status:** Deferred — silent Anthropic fallback is intentional for backwards compat today

## Problem

`src/services/session.ts` (456 lines) is simultaneously a store, codec,
migrator, pruner, and summary projector:

- Path/key generation (lines 23-58)
- Session shapes and validation (lines 80-141)
- History normalisation (lines 143-160)
- Migration V1→V2 (lines 208-263)
- Project loading/pruning (lines 265-371)
- Listing/projection (lines 388-423)
- Saving (lines 425-456)

The V2 guard only checks that `llmProvider` is a `string` (lines 102-113), then
unknown providers are silently coerced to `'anthropic'` (line 169 and line 442).
This means a session file written by a future Orb version with a new provider
(e.g. `'mistral'`) will be loaded as an Anthropic session without warning.

## Evidence

| Lines                             | Concern                                                       |
| --------------------------------- | ------------------------------------------------------------- |
| `src/services/session.ts:102-113` | V2 guard only checks `typeof llmProvider === 'string'`        |
| `src/services/session.ts:169`     | `normalizeSessionProvider(parsed.llmProvider) ?? 'anthropic'` |
| `src/services/session.ts:442`     | same fallback on save                                         |

## Remediation direction

1. **Split into separate modules**:
   - `SessionCodec` — parse, validate, and normalise session JSON
   - `SessionStore` — read/write files
   - `SessionMigrator` — V1→V2 and future migrations
   - `SessionSummaryProjector` — listing and picker display

2. **Treat unknown providers as unreadable** unless an explicit migration path
   exists. Return `null` from `normalizeLoaded` for unknown providers and emit
   a warning so the user knows a session was skipped, rather than silently
   loading it under the wrong provider.

   The V1→Anthropic fallback is intentional and should be kept; only
   _post-migration_ unknown providers need explicit handling.
