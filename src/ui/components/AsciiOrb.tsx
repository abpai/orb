import React, { memo, useMemo } from 'react'
import { Box, Text } from 'ink'

import { useAnimationFrame } from '../hooks/useAnimationFrame'

export type AnimationMode = 'idle' | 'processing' | 'speaking'

interface AsciiOrbProps {
  mode?: AnimationMode
  width?: number
  height?: number
}

// Amp-style dense character set (sparse to dense)
const CHARS = ' .:=-+*#@'

// Mode-specific animation parameters
const MODE_CONFIG = {
  idle: { fps: 10, amplitude: 0.1, speed: 0.05, color: 'cyan' },
  processing: { fps: 15, amplitude: 0.2, speed: 0.15, color: 'yellow' },
  speaking: { fps: 20, amplitude: 0.25, speed: 0.3, color: 'magenta' },
} as const

/**
 * Renders an animated ASCII orb with radial distance-based character density.
 * The orb appears 3D through careful character selection based on distance from center.
 */
function AsciiOrbComponent({ mode = 'idle', width = 30, height = 11 }: AsciiOrbProps) {
  const config = MODE_CONFIG[mode]
  const frame = useAnimationFrame({ fps: config.fps, active: true })

  const lines = useMemo(() => {
    const result: string[] = []
    const centerX = width / 2
    const centerY = height / 2

    // Terminal characters are ~2x taller than wide
    // To make circle appear round, scale down vertical distance contribution
    const aspectRatio = 2.0

    for (let y = 0; y < height; y++) {
      let line = ''

      for (let x = 0; x < width; x++) {
        // Normalized coordinates (-1 to 1)
        const nx = (x - centerX) / centerX
        const ny = (y - centerY) / centerY / aspectRatio

        // Distance from center (0 at center, 1 at edge)
        const dist = Math.sqrt(nx * nx + ny * ny)

        // Animation: apply mode-specific oscillation
        let animatedDist: number

        if (mode === 'speaking') {
          // Bouncy, energetic oscillation with compound sine waves
          const bounce = Math.sin(frame * config.speed) * Math.sin(frame * config.speed * 0.33)
          animatedDist = dist + bounce * config.amplitude
        } else {
          // Simple breathing/pulse
          animatedDist = dist + Math.sin(frame * config.speed) * config.amplitude
        }

        // Map distance to character (closer = denser)
        if (animatedDist > 1) {
          line += ' '
        } else {
          // Invert so center is dense, edges are sparse
          const normalized = 1 - animatedDist
          const charIndex = Math.floor(normalized * (CHARS.length - 1))
          line += CHARS[Math.min(charIndex, CHARS.length - 1)]
        }
      }

      result.push(line)
    }

    return result
  }, [frame, mode, width, height, config])

  return (
    <Box flexDirection="column" alignItems="center">
      {lines.map((line, i) => (
        <Text key={`orb-line-${i}`} color={config.color}>
          {line}
        </Text>
      ))}
    </Box>
  )
}

export const AsciiOrb = memo(AsciiOrbComponent)
