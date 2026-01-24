/**
 * Truncate text to a maximum number of lines, keeping the last N lines (tail).
 * Useful for streaming content where the most recent output is most relevant.
 */
export function truncateLines(
  text: string,
  maxLines: number,
): { text: string; truncatedCount: number } {
  const lines = text.split('\n')
  if (lines.length <= maxLines) {
    return { text, truncatedCount: 0 }
  }
  const truncated = lines.slice(-maxLines)
  return {
    text: truncated.join('\n'),
    truncatedCount: lines.length - maxLines,
  }
}
