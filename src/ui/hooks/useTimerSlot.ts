import { useCallback, useEffect, useRef } from 'react'

/**
 * A single reusable timeout slot.
 *
 * Encapsulates the null-check / clearTimeout / null-out dance that surrounds any
 * cancellable `setTimeout` so the bookkeeping can't drift out of sync. `schedule`
 * clears any pending timer before arming a new one, `clear` cancels the pending
 * timer (idempotent), and the slot auto-clears on unmount so no callback fires
 * against a torn-down component.
 */
export function useTimerSlot() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const schedule = useCallback(
    (fn: () => void, delayMs: number) => {
      clear()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        fn()
      }, delayMs)
    },
    [clear],
  )

  useEffect(() => clear, [clear])

  return { schedule, clear }
}
