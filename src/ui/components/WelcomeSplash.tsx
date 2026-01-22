import { Box, Text } from 'ink'

export function WelcomeSplash() {
  return (
    <Box flexDirection="column" alignItems="center" marginY={2}>
      <Text color="cyan">▁▂▃▄▅▆▇█▇▆▅▄▃▂▁</Text>
      <Text> </Text>
      <Text color="gray">talk to claude</Text>
      <Text> </Text>
      <Text color="cyan" dimColor>
        say anything
      </Text>
    </Box>
  )
}
