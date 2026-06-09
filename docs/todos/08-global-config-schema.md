# #8 — Replace manual parse/apply/serialize triplication in global-config.ts

**Severity:** Medium (structural)
**Status:** Deferred — adding any new config key currently requires three synchronized edits

## Problem

Every TTS config field in `src/services/global-config.ts` is written three times:

1. **Parse** (`parseGlobalConfigToml`, lines 219-292): validate TOML value,
   map snake_case to camelCase, set explicit flag
2. **Apply** (`applyGlobalConfig`, lines 327-354): copy camelCase field from
   `OrbGlobalConfig` into `AppConfig`
3. **Serialize** (`serializeGlobalConfig`, lines 359-386): map camelCase back
   to snake_case TOML, ends with `document as any` cast (line 384-386)

Drift between the three representations is structurally easy.  The `any` cast
at the serialize boundary hides type mismatches.

## Evidence

| Lines | What it does |
|-------|-------------|
| `src/services/global-config.ts:219-292` | manual parse + validate |
| `src/services/global-config.ts:327-354` | manual apply |
| `src/services/global-config.ts:359-386` | manual serialize + `as any` |

## Remediation direction

Define a **config field descriptor array** — one entry per field:

```ts
interface ConfigFieldDescriptor<T> {
  tomlKey: string        // snake_case TOML key
  appKey: keyof AppConfig
  orbKey: keyof OrbGlobalTtsConfig
  validate: (raw: unknown, path: string, warnings: string[]) => T | undefined
  explicitFlag?: keyof ExplicitFlags
}
```

Generate `parseGlobalConfigToml`, `applyGlobalConfig`, and
`serializeGlobalConfig` from that array.  A new field is one new descriptor
entry; parse, apply, serialize, and explicit-flag tracking all follow
automatically.  The `as any` cast disappears because the serialization output is
built from typed descriptors.
