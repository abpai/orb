# #20 — Make usePipeline lifecycle explicit

**Severity:** Medium-Low (structural)
**Status:** Deferred — React lifecycle and task lifecycle are implicitly misaligned

## Problem

`src/ui/hooks/usePipeline.ts` constructs `task` and `transport` once with an
empty dependency array (lines 52-64), capturing `config`, `initialModel`,
`initialSession`, and `createTask` at construction time. Config changes are
then synced by mutating the task via `task.updateConfig(activeConfig)` (lines
66-68). The task itself just reassigns its local `config` variable (task.ts:285-287).

The distinction between one-time inputs (initialModel, initialSession, createTask)
and mutable inputs (config) is implicit and enforced only by hook implementation
details. A future reader cannot know which inputs are stable without reading
both the hook and the task implementation.

## Evidence

| Lines                               | Concern                                            |
| ----------------------------------- | -------------------------------------------------- |
| `src/ui/hooks/usePipeline.ts:52-64` | `useMemo` with empty deps, captures initial inputs |
| `src/ui/hooks/usePipeline.ts:66-68` | `task.updateConfig(activeConfig)` for ongoing sync |
| `src/pipeline/task.ts:285-287`      | `updateConfig` just reassigns `config` variable    |

## Remediation direction

Option A: Use a `useRef` initializer with a comment explicitly listing which
inputs are one-time and which are mutable:

```ts
const taskRef = useRef<PipelineTask | null>(null)
if (!taskRef.current) {
  // One-time inputs: initialModel, initialSession, createTask
  taskRef.current = createTask({
    appConfig: { ...config, llmModel: initialModel },
    session: initialSession,
    transport,
  })
}
```

Option B: Pass `config` and `session` into `run()` directly instead of
maintaining mutable internal state — the task would be stateless between runs
and `updateConfig` would disappear.

Either way, document which inputs are stable vs mutable at the call site.
