import { memo } from 'react'
import { Text } from 'ink'

import type { AppState } from '../../types'
import { useAnimationFrame } from '../hooks/useAnimationFrame'

const BRAILLE_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'] as const

interface MicroOrbProps {
  state: AppState
}

export const MicroOrb = memo(function MicroOrb({ state }: MicroOrbProps) {
  const isAnimating = state === 'processing' || state === 'processing_speaking'
  const frame = useAnimationFrame({ fps: 8, active: isAnimating })

  if (state === 'idle') {
    return <Text color="green">●</Text>
  }

  if (state === 'speaking') {
    return <Text color="magenta">●</Text>
  }

  const color = state === 'processing_speaking' ? 'magenta' : 'yellow'
  const char = BRAILLE_FRAMES[frame % BRAILLE_FRAMES.length]

  return <Text color={color}>{char}</Text>
})
