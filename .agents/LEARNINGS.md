# LEARNINGS

## Corrections

| Date | Source | What Went Wrong | What To Do Instead |
| ---- | ------ | --------------- | ------------------ |
| 2026-03-12 | self | Assumed project memory file existed because AGENTS.md referenced it | Create `.agents/LEARNINGS.md` at task start when the repo does not have one yet |
| 2026-03-12 | self | Review found the app intended to disable input while busy, but `App` always passed `disabled={false}` | When the UI state machine claims input is blocked, add an explicit test at the top-level `App` boundary instead of trusting leaf component behavior |
| 2026-03-12 | self | Assumed changing `process.env.HOME` during Bun tests would redirect `os.homedir()` | In Bun, treat `os.homedir()` as effectively fixed for the test process; clean up exact files instead of trying to fake HOME |
| 2026-03-12 | self | Mocked shared modules in one test file and accidentally polluted unrelated tests through Bun's module cache | For Bun module mocks, import the target module only after mocking, restore mocks after each test, and avoid mocking shared modules when a real implementation is safe |
| 2026-03-12 | self | Let a pipeline task call `onRunEnd` with placeholder zeroed metrics, which overwrote observer-tracked counts at completion | When observers already accumulate per-frame metrics, finalize from the observer's current snapshot instead of trusting placeholder end-of-run payloads |

## User Preferences

- Prefer concrete readiness reviews with evidence from the repo and real checks.

## Patterns That Work

- For this repo, targeted Bun tests and build/lint/typecheck runs quickly expose whether CLI hardening changes are safe.
- The new frame/pipeline layer is a good seam for cancellation and integration tests without needing live provider credentials.

## Patterns That Don't Work

- Relying only on leaf-component tests misses state wiring bugs in `App`.

## Domain Notes

- `orb` is a Bun + Ink terminal app for code exploration with Anthropic/OpenAI backends and optional TTS.
- Public-beta readiness depends more on state-machine correctness, cancellation, auth/session behavior, and seam tests than on a larger architecture rewrite.
