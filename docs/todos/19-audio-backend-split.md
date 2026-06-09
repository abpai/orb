# #19 — Unify audio playback backend ownership

**Severity:** Medium-Low (structural)
**Status:** Deferred — two separate playback paths work today but diverge on pause/stop

## Problem

`src/services/audio-player.ts` claims to be the single place that knows
player-specific spawn args and pause mechanics, owning `mpv`/`ffplay` backends
(lines 34-37).  But `src/services/tts.ts` still:

- Spawns `afplay` directly (lines 278-288) for generated-file playback
- Keeps module-level `currentPlayback` globals (lines 132-136)

Pause/resume/stop therefore depends on *which code path created the audio*:
streaming paths go through the `audio-player` abstraction; generate-mode paths
use the `tts.ts` globals.  A caller cannot reliably pause/stop without knowing
which mode is active.

## Evidence

| Lines | Concern |
|-------|---------|
| `src/services/audio-player.ts:1-4` | claims sole ownership of player backends |
| `src/services/audio-player.ts:34-37` | mpv/ffplay backends |
| `src/services/tts.ts:278-288` | direct `afplay` spawn |
| `src/services/tts.ts:132-136` | module-level `currentPlayback` state |

## Remediation direction

Either:
- Move generated-file playback (`afplay`) behind the same `AudioPlayer` backend
  interface used by streaming paths, so all playback has instance-scoped
  pause/stop controls; **or**
- Create an explicit `GeneratedFilePlayer` with the same interface as
  `AudioPlayer` (start, pause, resume, stop, done promise), and ensure
  `tts.ts` exposes an instance rather than module-level globals.

Either way, `streaming-tts.ts` should not need to import `pauseSpeaking` /
`stopSpeaking` from `tts.ts` — those globals leak across the abstraction
boundary.  See also `02-tts-run-abstraction.md`.
