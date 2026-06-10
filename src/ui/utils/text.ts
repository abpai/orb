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

/**
 * Collapse all runs of whitespace (including newlines) to single spaces, trim,
 * and clip to `max` characters with a trailing ellipsis. Used for one-line
 * previews where multi-line content must render on a single row.
 */
export function collapseToSingleLine(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed
}
