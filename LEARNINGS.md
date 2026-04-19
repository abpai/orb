# LEARNINGS

Durable lessons from Pi runs. Each entry names the run, the trap, and the rule for next time.

## Run: `openai-sandbox-split` (2026-04-18)

### Bun `mock.restore()` does not reset `mock.module()` calls

Module mocks installed via `mock.module('path', factory)` persist across test
files within the same `bun test` invocation. `afterEach(() => mock.restore())`
only resets function mocks (`mock()` / `mock.fn()`), not module substitutions.

A module mock bleed from `openai.test.ts` silently broke `sandbox` and `tools`
tests that ran afterwards (they imported the mocked factory instead of the
real one). Diagnosis cost 30+ minutes.

**Rule for next time:** In this repo, prefer passing real modules into
adapter tests where the real module is safe to construct (e.g.,
`LocalSubprocessSandbox` has a no-op constructor). Reserve `mock.module` for
external SDKs (`ai`, provider clients) and do it at the file where it is
needed. If you must mock an internal module, document the bleed risk and
isolate the test so it runs alone or resets the module explicitly with
`mock.module('path', () => actualImpl)` at file end.

### `AbortSignal.addEventListener` is not retroactive

Adding an `abort` listener to an already-aborted `AbortSignal` does NOT fire
the listener. This matches the WHATWG spec and Bun 1.3.12's behavior.
Consequence: any code that does `if (signal.aborted) throw` followed by
`await someAsyncStep()` followed by `signal.addEventListener('abort', …)`
has a TOCTOU race — if the signal aborts during the await, the listener
never fires and the downstream operation is not cancelled.

**Rule for next time:** when wiring an AbortSignal to a long-lived handle
through an async path, re-check `signal.aborted` _after_ every `await` and
_immediately before_ the side effect the listener is meant to protect.
Prefer native signal support on the underlying API (e.g.,
`Bun.spawn({ signal })`) over a manual `addEventListener` pattern when the
option exists. Write at least one test that combines the signal with every
async-resolving parameter — in this run, the missing `signal + opts.cwd`
combined test is what hid the race.

### Capability injection over ambient authority in ai-SDK tools

The `ai` SDK's `experimental_context` option on `agent.stream({...})` is the
supported channel for passing per-turn capabilities (e.g., a `Sandbox`
instance) into tool `execute` functions. Tools receive the context as
`options.experimental_context` inside their `execute(input, options)`
callback. This keeps tools pure functions of their input + a narrow
capability and avoids module-level singletons or closures over adapter
state.

**Rule for next time:** when adding a new per-turn resource that a tool
needs (client, sandbox, session handle), inject it through
`experimental_context` rather than importing it inside the tool module.
Type the context at the tool boundary (`ctx.sandbox: Sandbox;
ctx.signal: AbortSignal`) so a missing field is a TypeScript error, not a
runtime surprise.

### Pipe-buffer deadlock: always drain stdout and stderr in parallel

When spawning a subprocess with `stdout: 'pipe', stderr: 'pipe'`, a serial
read (`await stdout.text(); await stderr.text()`) will deadlock if either
stream fills its pipe buffer (~64KB on macOS) before the other is drained.
The kernel blocks the child's write, which blocks the child's exit, which
blocks the serial reader.

**Rule for next time:** always drain stdout, stderr, and `proc.exited` via
`Promise.all`:

```ts
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])
```

Write a test that emits >64KB to each stream so the regression fails loudly.

### Verify what a dependency actually runs before trusting a threat-model claim

The original plan for this run and its R2 risk note both framed the refactor
as moving OpenAI execution from "remote Firecracker microVM" (`@vercel/sandbox`)
to a local subprocess — a meaningful _loss_ of isolation that would need to
land in the PR description. After the code was merged-ready, a direct
inspection of `node_modules/bash-tool` showed the framing was wrong:

- `openai.ts` on `main` called `createBashTool({ uploadDirectory, maxFiles })`
  with no `options.sandbox`.
- `bash-tool/dist/tool.js` line ~99 falls through to
  `// No external sandbox - use just-bash` when no sandbox instance is passed.
- `@vercel/sandbox` is an _optional peer dep_ that this project never
  installed (not in `package.json`, not in `bun.lock`).

So the pre-refactor code was already running locally via `just-bash` against
`process.cwd()` with full env inheritance and no path clamp. The new
`LocalSubprocessSandbox` is _more_ restrictive (adds a cwd clamp + symlink
escape rejection). The PR body had to be rewritten to frame this as a
tightening, not a regression.

**Rule for next time:** before a plan's threat-model claim goes into a brief
(or a PR body), verify what the relevant dependency actually does at runtime
in _this_ repo:

1. Does the direct dep graph (`package.json` + `bun.lock`) include the
   package implementing the claimed behavior, or is it an optional peer?
2. If the behavior is gated on a constructor argument, grep the call sites
   in `src/` for that argument.
3. If in doubt, read the compiled JS under `node_modules/<dep>/dist/` and
   trace which code path actually runs.

A plan's summary of upstream dependency behavior is a claim, not a fact.
Verify before shipping.

### Tool name continuity matters for OpenAI `previousResponseId`

When resuming an OpenAI Responses session via `previousResponseId`, the
prior turn's tool-call IDs reference tool names that must still exist with
the same schema on the current turn. Renaming a tool (`bash` →
`runBash`) silently breaks continuation: the model emits a tool call for
the old name, validation fails, and the session can't progress without a
restart. Schema widening is typically safe; narrowing or renaming is not.

**Rule for next time:** lock tool names in a constant that the adapter and
the tools barrel both import. If a rename is genuinely needed, land it
behind a session-reset migration.
