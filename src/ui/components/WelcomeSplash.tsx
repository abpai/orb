import { Box, Text } from 'ink'

import { AsciiOrb, type AnimationMode } from './AsciiOrb'

interface WelcomeSplashProps {
  animationMode?: AnimationMode
  assistantLabel?: string
  projectName?: string
  modelLabel?: string
  ttsVoice?: string
  ttsSpeed?: number
  ttsEnabled?: boolean
}

function formatConfigSummary(
  modelLabel?: string,
  ttsVoice?: string,
  ttsSpeed?: number,
  ttsEnabled?: boolean,
): string | null {
  const parts: string[] = []
  if (modelLabel) parts.push(modelLabel.toLowerCase())
  if (ttsEnabled && ttsVoice) {
    parts.push(ttsVoice)
    if (ttsSpeed != null) parts.push(`x${ttsSpeed}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

function spaceLetters(name: string): string {
  return name.split('').join(' ')
}

export function WelcomeSplash({
  animationMode = 'idle',
  assistantLabel = 'claude',
  projectName,
  modelLabel,
  ttsVoice,
  ttsSpeed,
  ttsEnabled,
}: WelcomeSplashProps) {
  const configSummary = formatConfigSummary(modelLabel, ttsVoice, ttsSpeed, ttsEnabled)

  return (
    <Box flexDirection="column" alignItems="center" marginY={1}>
      {projectName && (
        <>
          <Text color="gray" dimColor>
            {spaceLetters(projectName)}
          </Text>
          <Text> </Text>
        </>
      )}
      <AsciiOrb mode={animationMode} />
      <Text> </Text>
      <Text color="gray">talk to {assistantLabel}</Text>
      <Text> </Text>
      <Text color="cyan" dimColor>
        say anything
      </Text>
      {configSummary && (
        <>
          <Text> </Text>
          <Text color="gray" dimColor>
            {configSummary}
          </Text>
        </>
      )}
    </Box>
  )
}
