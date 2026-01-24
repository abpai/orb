import { useEffect, useState } from 'react'

interface UseAnimationFrameOptions {
  fps?: number
  active?: boolean
}

/**
 * Custom hook for frame-based animation with configurable FPS.
 * Returns an incrementing frame counter that triggers re-renders at the specified rate.
 * Uses setInterval for Node.js compatibility (no requestAnimationFrame in terminal).
 */
export function useAnimationFrame({
  fps = 30,
  active = true,
}: UseAnimationFrameOptions = {}): number {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!active) return

    const intervalMs = Math.floor(1000 / fps)
    const intervalId = setInterval(() => {
      setFrame((f) => f + 1)
    }, intervalMs)

    return () => {
      clearInterval(intervalId)
    }
  }, [fps, active])

  return frame
}
