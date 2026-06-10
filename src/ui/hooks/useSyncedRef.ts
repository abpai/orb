import { useCallback, useRef, useState } from 'react'

/**
 * State paired with a ref mirror that is always updated in the same call.
 *
 * Ink dispatches keystrokes synchronously: an input handler often needs to read
 * the *current* value and decide what to do before React has re-rendered with the
 * latest state. A bare `useState` value would be stale inside that handler, so we
 * keep a ref mirror that is written synchronously alongside `setState`. The ref is
 * the source of truth for synchronous reads (guards, archive checks, debounced
 * callbacks); the state drives rendering. Both must move together — hence this hook
 * exists to make the mirror impossible to forget.
 *
 * Returns `[value, ref, set]`. `set` accepts a value or an updater (computed from
 * the ref, so it stays correct under back-to-back synchronous updates).
 */
export function useSyncedRef<T>(
  initial: T | (() => T),
): [T, React.RefObject<T>, (next: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial)
  const ref = useRef<T>(value)

  const set = useCallback((next: T | ((current: T) => T)) => {
    const resolved = typeof next === 'function' ? (next as (current: T) => T)(ref.current) : next
    ref.current = resolved
    setValue(resolved)
  }, [])

  return [value, ref, set]
}
