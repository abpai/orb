import React from 'react'
import { Box, Text } from 'ink'

import { AsciiOrb, type AnimationMode } from './AsciiOrb'

interface WelcomeSplashProps {
  animationMode?: AnimationMode
}

export function WelcomeSplash({ animationMode = 'idle' }: WelcomeSplashProps) {
  return (
    <Box flexDirection="column" alignItems="center" marginY={1}>
      <AsciiOrb mode={animationMode} />
      <Text> </Text>
      <Text color="gray">talk to claude</Text>
      <Text> </Text>
      <Text color="cyan" dimColor>
        say anything
      </Text>
    </Box>
  )
}
