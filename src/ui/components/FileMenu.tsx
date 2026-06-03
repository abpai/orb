import { memo } from 'react'
import { Box, Text } from 'ink'

interface FileMenuProps {
  /** Repo-relative paths to show, best match first. */
  items: string[]
  /** Index of the highlighted row. */
  selected: number
}

/**
 * Dropdown of file-path completions shown beneath the input while the user is
 * typing an `@`-mention. Renders nothing when there are no items so an empty
 * result set leaves the input untouched.
 */
export const FileMenu = memo(function FileMenu({ items, selected }: FileMenuProps) {
  if (items.length === 0) return null

  return (
    <Box flexDirection="column" marginLeft={4}>
      {items.map((item, index) => {
        const isSelected = index === selected
        return (
          <Text key={item} color={isSelected ? 'cyan' : 'gray'} inverse={isSelected}>
            {isSelected ? '› ' : '  '}
            {item}
          </Text>
        )
      })}
      <Text color="gray" dimColor>
        ↑↓ select · ⏎/⇥ insert · esc dismiss
      </Text>
    </Box>
  )
})
