import { memo } from 'react'
import { Box, Text } from 'ink'

import { AsciiOrb, type AnimationMode } from './AsciiOrb'

interface OrbPanelProps {
  animationMode: AnimationMode
}

export const OrbPanel = memo(function OrbPanel({ animationMode }: OrbPanelProps) {
  return (
    <Box
      width={32}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
    >
      <AsciiOrb mode={animationMode} width={22} height={11} />
      <Text color="gray">talk to claude</Text>
    </Box>
  )
})
