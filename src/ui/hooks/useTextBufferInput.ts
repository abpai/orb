import { useRef, useState } from 'react'
import {
  empty,
  type TextBufferState,
} from '../input/TextBuffer'

export interface CycleState {
  matches: string[]
  index: number
}

export interface TextBufferInput {
  buffer: TextBufferState
  bufferRef: React.RefObject<TextBufferState>
  desiredColRef: React.RefObject<number>
  cycleRef: React.RefObject<CycleState | null>
  update: (
    fn: (current: TextBufferState) => TextBufferState,
    opts?: { resetDesiredCol?: boolean },
  ) => TextBufferState | null
}

export function useTextBufferInput(): TextBufferInput {
  const [buffer, setBuffer] = useState<TextBufferState>(() => empty())
  const bufferRef = useRef<TextBufferState>(buffer)
  const desiredColRef = useRef<number>(0)
  const cycleRef = useRef<CycleState | null>(null)

  function update(
    fn: (current: TextBufferState) => TextBufferState,
    opts: { resetDesiredCol?: boolean } = {},
  ): TextBufferState | null {
    const next = fn(bufferRef.current)
    if (next === bufferRef.current) return null
    if (opts.resetDesiredCol ?? true) desiredColRef.current = next.col
    bufferRef.current = next
    setBuffer(next)
    return next
  }

  return { buffer, bufferRef, desiredColRef, cycleRef, update }
}
