/**
 * Strip markdown formatting for clean terminal display.
 * Keeps code blocks/inline code visible since they're meaningful in a code context.
 */
export function stripMarkdown(text: string): string {
  const preserved: string[] = []

  const preserve = (input: string, pattern: RegExp): string =>
    input.replace(pattern, (match) => {
      const token = `@@PRESERVE_${preserved.length}@@`
      preserved.push(match)
      return token
    })

  const restore = (input: string): string =>
    input.replace(/@@PRESERVE_(\d+)@@/g, (_, index) => preserved[Number(index)] ?? '')

  const withoutCode = preserve(preserve(text, /```[\s\S]*?```/g), /`[^`]*`/g)

  return restore(
    withoutCode
      // Links: [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Bold: **text** or __text__ → text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      // Italic: *text* or _text_ → text
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
      // Strikethrough: ~~text~~ → text
      .replace(/~~([^~]+)~~/g, '$1')
      // Headers: # Header → Header
      .replace(/^#{1,6}\s*/gm, '')
      // Blockquotes: > text → text
      .replace(/^\s*>+\s?/gm, '')
      // Unordered lists: - item or * item → item
      .replace(/^\s*[-*]\s+/gm, '')
      // Ordered lists: 1. item → item
      .replace(/^\s*\d+\.\s+/gm, '')
      // Horizontal rules: --- or *** → empty
      .replace(/^[-*]{3,}\s*$/gm, ''),
  )
}

/**
 * Clean text for speech synthesis.
 * Removes code blocks/inline code (replacing with spoken placeholders),
 * strips markdown, and collapses whitespace.
 */
export function cleanTextForSpeech(text: string): string {
  const replaceCodeBlocks = (input: string): string => {
    const fence = '```'
    let result = ''
    let cursor = 0

    while (true) {
      const start = input.indexOf(fence, cursor)
      if (start === -1) {
        result += input.slice(cursor)
        return result
      }

      const end = input.indexOf(fence, start + fence.length)
      if (end === -1) {
        result += input.slice(cursor, start) + ' code block '
        return result
      }

      result += input.slice(cursor, start) + ' code block '
      cursor = end + fence.length
    }
  }

  const replaceInlineCode = (input: string): string => {
    let result = ''
    let cursor = 0

    while (true) {
      const start = input.indexOf('`', cursor)
      if (start === -1) {
        result += input.slice(cursor)
        return result
      }

      const end = input.indexOf('`', start + 1)
      if (end === -1) {
        result += input.slice(cursor, start) + ' code '
        return result
      }

      result += input.slice(cursor, start) + ' code '
      cursor = end + 1
    }
  }

  return (
    replaceInlineCode(replaceCodeBlocks(text))
      // Apply standard markdown stripping
      .split('\n')
      .map((line) => stripMarkdown(line))
      .join('\n')
      // Collapse whitespace
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}
