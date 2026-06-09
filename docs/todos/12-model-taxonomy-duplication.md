# #12 — Unify model taxonomy in model-catalog.ts

**Severity:** Medium (structural)
**Status:** Deferred — adding/renaming a model family currently touches 5+ switch/regex sites

## Problem

Model family knowledge is scattered across `src/services/model-catalog.ts` (566 lines):

- **Fallback aliases and labels** defined at lines 70-146
- **Alias matching** re-implemented in `matchesAlias()` at lines 339-367
- **Family classification** re-implemented in `modelAliasFamily()` at lines 375-397
- **Label generation** as another provider-specific branch at lines 465-486
- **Choices/resolution** repeating alias concepts at lines 489-546

Every new model family or renamed alias requires edits across all of these sites.

## Evidence

| Lines | Concern |
|-------|---------|
| `src/services/model-catalog.ts:70-146` | alias/label definitions |
| `src/services/model-catalog.ts:339-367` | `matchesAlias()` |
| `src/services/model-catalog.ts:375-397` | `modelAliasFamily()` |
| `src/services/model-catalog.ts:465-486` | label generation |
| `src/services/model-catalog.ts:489-546` | choices/resolution |

## Remediation direction

Define a **model family descriptor** per provider:

```ts
interface ModelFamilyDescriptor {
  name: string                  // 'opus', 'sonnet', …
  aliases: string[]             // shorthand aliases
  fallbackModel: string         // resolved concrete ID
  matcher: (id: string) => boolean
  label: (id: string) => string
  order: number                 // sort position in picker
}
```

Derive `matchesAlias`, `modelAliasFamily`, label generation, choices, and
resolution from the descriptor array.  A new model family is one new descriptor;
all derived logic follows.
