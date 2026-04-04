# LEARNINGS

## Corrections

| Date | Source | What Went Wrong | What To Do Instead |
| ---- | ------ | --------------- | ------------------ |
| 2026-03-12 | self | Assumed project memory file existed because AGENTS.md referenced it | Create `.agents/LEARNINGS.md` at task start when the repo does not have one yet |
| 2026-03-12 | self | Review found the app intended to disable input while busy, but `App` always passed `disabled={false}` | When the UI state machine claims input is blocked, add an explicit test at the top-level `App` boundary instead of trusting leaf component behavior |
| 2026-03-12 | self | Assumed changing `process.env.HOME` during Bun tests would redirect `os.homedir()` | In Bun, treat `os.homedir()` as effectively fixed for the test process; clean up exact files instead of trying to fake HOME |
| 2026-03-12 | self | Mocked shared modules in one test file and accidentally polluted unrelated tests through Bun's module cache | For Bun module mocks, import the target module only after mocking, restore mocks after each test, and avoid mocking shared modules when a real implementation is safe |
| 2026-03-12 | self | Let a pipeline task call `onRunEnd` with placeholder zeroed metrics, which overwrote observer-tracked counts at completion | When observers already accumulate per-frame metrics, finalize from the observer's current snapshot instead of trusting placeholder end-of-run payloads |
| 2026-03-12 | self | Streaming TTS handed off a `tts-pending` handle and then immediately stopped the controller in the processor `finally`, so Orb never sent the synth request | When async work is handed off via a pending frame, keep ownership with the caller and do not tear it down in the processor cleanup path |
| 2026-03-12 | self | Treated streaming TTS failures as callback-only side effects, which let `waitForCompletion()` resolve successfully and hid speech failures from the UI | For async side-channel work in this repo, reject the awaited completion promise on real failures so `PipelineTask` can surface UI errors |
| 2026-03-12 | self | Sending Orb's pocket voice names directly to `tts-gateway` Kokoro caused `502` voice lookup failures (`alba.pt` missing) | For serve-mode compatibility, retry once without an explicit voice when the server rejects the requested voice so gateway defaults can recover |
| 2026-03-13 | self | Mocked `./tts` in `streaming-tts.test.ts`, which poisoned Bun's module cache and broke later tests that needed the real TTS module | In this repo, prefer mocking runtime primitives like `fetch` and `Bun.spawn` over mocking shared service modules when tests run in the same Bun process |
| 2026-03-13 | self | Passed OpenAI resume instructions through `ToolLoopAgent.instructions`, which re-appended the system prompt on every `previousResponseId` continuation | When continuing OpenAI Responses conversations, omit agent-level instructions and pass the prompt through `providerOptions.openai.instructions` instead |
| 2026-03-20 | self | Ran the `useConversation` persistence test in the Codex sandbox and it failed with `EPERM` because session writes target `~/.orb/sessions`, which is outside the writable roots | For hook/session persistence verification in this environment, expect real-save tests to be sandbox-blocked unless the session path is redirected into the workspace |
| 2026-03-20 | self | Changed the default serve-mode TTS URL in code without updating the documented setup flow, which would have broken out-of-the-box speech for users following the README | When moving runtime defaults here, verify the code, README examples, and CLI help still agree before treating the change as safe |
| 2026-03-20 | self | Tested `runSetup()` directly and initially missed that `runSetupCommand()` was still prepending `"setup"` into Commander parsing, which would have broken the real `orb setup` path | For new command entrypoints here, add at least one test against the command-level wrapper, not just the lower-level handler |
| 2026-03-20 | self | Assumed macOS `say` would naturally fit Orb's existing `.wav` temp-file convention | When switching local TTS generation to `say`, treat the output as AIFF-backed and keep temp-path handling aligned with the actual generator instead of assuming WAV semantics |
| 2026-03-24 | self | Release docs originally told users to `uv tool install tts-gateway[kokoro]` but skipped Kokoro's required `en_core_web_sm` install inside the uv tool environment | For Orb's serve-mode docs and setup hints, always include the manual spaCy model install or first-request Kokoro failures will look like Orb bugs |
| 2026-04-03 | self | Treated `ReadableStreamDefaultReader.releaseLock()` as reliable cleanup on Bun fetch response bodies, but delayed prefetched TTS streams can throw `TypeError: undefined is not a function` there after successful playback | In Orb's streaming TTS cleanup, treat `releaseLock()` as best-effort and swallow cleanup-only failures instead of surfacing them as speech synthesis errors |
| 2026-04-03 | self | Assumed `tts-gateway` used JSON for both `/tts/stream` and `/v1/speech`, but the reference server still expects `multipart/form-data` for `/v1/speech` | In Orb's gateway client, keep `/tts/stream` on JSON and `/v1/speech` on `FormData`; verify each route against the actual FastAPI parameter types instead of normalizing them by intuition |

## User Preferences

- Prefer concrete readiness reviews with evidence from the repo and real checks.
- For scratch/demo work, present an alignment table of candidate concepts and wait for approval before creating scripts.

## Patterns That Work

- For this repo, targeted Bun lint/test runs quickly expose whether CLI and pipeline changes are safe; the app now ships as a Bun-native source CLI instead of a built `dist/` package.
- When TTS code needs temp audio files in multiple paths, centralizing the temp-path builder helps keep the `.aiff`/`.mp3` extension choice aligned with `ttsMode` and avoids reintroducing macOS `say` mismatches.
- For this repo's Bun-only quality gate, keep `.prettierignore` aligned with non-product areas like `scratch/` and `.agents/` so `bun run check` enforces source formatting without blocking on demo or memory files.
- In this repo's often-dirty worktree, run `bun run check` for signal, but verify touched files with targeted `prettier --check` too so unrelated formatting drift does not force edits to user-owned files.
- When simplifying Orb's CLI surface, trace config fields from `src/cli.ts` and `src/config.ts` outward; `permissionMode: 'acceptEdits'` had become unreachable even though downstream Anthropic code still carried branches for it.
- The new frame/pipeline layer is a good seam for cancellation and integration tests without needing live provider credentials.
- For large Orb refactors, split commits by runtime seam rather than by folder: TTS service hardening, pipeline contract cleanup, UI hook extraction, then legacy/docs cleanup keeps each commit reviewable and green.
- When updating architecture docs here, anchor the narrative on `src/index.ts -> src/ui/App.tsx -> src/pipeline/**` first, then describe older concepts only as historical caveats.
- Architecture docs here also need the non-runtime support layers called out explicitly: `src/setup.ts`, `src/services/global-config.ts`, and `prompts/*.md` are part of the current operating model, not optional footnotes.
- For external setup commands in Orb docs, prefer stable upstream entrypoints like `python -m spacy download ...` over pinned artifact URLs unless the version pin is enforced in code too.
- `mock.module()` works under plain `bun run` scripts here, which makes `scratch/` demos a good place to drive runtime seams with mocked provider/TTS boundaries.
- For hook persistence regressions here, a small Ink harness plus the real session file is more reliable than mocking `saveSession`, especially when other tests may have already cached the hook module.
- For provider-doc audits here, prefer the canonical English Anthropic/OpenAI docs pages over localized variants; localized Anthropic model pages can lag the current model IDs.
- This repo's `prettier --check .` setup does not parse SVG, so release art belongs under an ignored path such as `assets/*.svg` unless the formatter stack changes.

## Patterns That Don't Work

- Relying only on leaf-component tests misses state wiring bugs in `App`.

## Domain Notes

- `orb` is a Bun + Ink terminal app for code exploration with Anthropic/OpenAI backends and optional TTS.
- Public-beta readiness depends more on state-machine correctness, cancellation, auth/session behavior, and seam tests than on a larger architecture rewrite.
- The current production execution path centers on `src/pipeline/**`; `ARCHITECTURE.md` still describes older `services/agent/*` paths and should not be treated as the full source of truth during recon.
- For dead-code audits in this repo, treat test-only pipeline seams like inbound transport and observers separately from truly dead symbols so cleanup stays conservative.
- Orb's current "streaming TTS" is sentence/chunk scheduling layered on temp audio files plus `afplay`, not end-to-end streamed audio transport; start playback investigations in `src/services/tts.ts` and `src/services/streaming-tts.ts`, not the UI.
