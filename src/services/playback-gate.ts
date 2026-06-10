// Single owner of the process-global playback control state that TTS playback
// (both the file-based afplay path in tts.ts and the streaming player loop in
// createStreamSession) coordinates through. Before this gate the same state
// lived as five loose module-level mutables; consolidating it keeps the
// load-bearing invariants in one place:
//
//   - version-bump-on-stop: stopAll() increments the control version so any
//     in-flight wait keyed to an older version resolves to "not ready"
//     (invalidating playback that was about to start or resume).
//   - resume-waiter flush: pausing parks callers in resumeWaiters; resume() and
//     stopAll() both flush them so they re-check readiness against the current
//     version instead of hanging forever.
//
// A snapshot of the version is taken at the start of a playback attempt and
// compared on every readiness check; a stop between snapshot and check is what
// aborts the attempt.

import type { FilePlayerProcess } from './audio-player'

export interface PlaybackGate {
  /** Snapshot the current control version at the start of a playback attempt. */
  snapshotVersion(): number
  /**
   * Resolve once playback is allowed to proceed for the given snapshot version.
   * Returns false when a stop bumped the version (snapshot is stale) — the
   * caller must abandon the attempt; true when ready to play/continue.
   */
  waitUntilReady(version: number): Promise<boolean>
  /** Pause playback; future readiness checks park until resume()/stopAll(). */
  pause(): void
  /** Resume playback and wake any parked waiters. */
  resume(): void
  /**
   * Stop all playback: clear pause, invalidate in-flight waits (version bump),
   * flush waiters, and kill the current file-playback process if any.
   */
  stopAll(): void
  /** Track the active afplay process so stopAll()/pause()/resume() can drive it. */
  setCurrentProcess(proc: FilePlayerProcess | null): void
  getCurrentProcess(): FilePlayerProcess | null
  /** Whether playback is currently paused (drives the streaming loop's wait). */
  isPaused(): boolean
  /** True after stopAll() killed a live process; cleared by resetStopped(). */
  wasStopped(): boolean
  resetStopped(): void
}

export function createPlaybackGate(): PlaybackGate {
  let currentProcess: FilePlayerProcess | null = null
  let stoppedManually = false
  let paused = false
  let controlVersion = 0
  const resumeWaiters = new Set<() => void>()

  function flushResumeWaiters(): void {
    for (const resolve of resumeWaiters) {
      resolve()
    }
    resumeWaiters.clear()
  }

  return {
    snapshotVersion() {
      return controlVersion
    },

    async waitUntilReady(version) {
      while (paused) {
        await new Promise<void>((resolve) => {
          resumeWaiters.add(resolve)
        })
        if (version !== controlVersion) {
          return false
        }
      }

      return version === controlVersion
    },

    pause() {
      paused = true
      currentProcess?.pause()
    },

    resume() {
      paused = false
      flushResumeWaiters()
      currentProcess?.resume()
    },

    stopAll() {
      paused = false
      controlVersion += 1
      flushResumeWaiters()

      if (currentProcess) {
        stoppedManually = true
        currentProcess.resume() // unblock if paused so kill takes effect
        currentProcess.kill()
        currentProcess = null
      }
    },

    setCurrentProcess(proc) {
      currentProcess = proc
    },

    getCurrentProcess() {
      return currentProcess
    },

    isPaused() {
      return paused
    },

    wasStopped() {
      return stoppedManually
    },

    resetStopped() {
      stoppedManually = false
    },
  }
}
