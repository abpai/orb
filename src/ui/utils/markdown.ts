/**
 * Strip markdown formatting for clean terminal display.
 * Keeps code blocks/inline code visible since they're meaningful in a code context.
 */
export function stripMarkdown(text: string): string {
  const preserved: string[] = []

  function preserve(input: string, pattern: RegExp): string {
    return input.replace(pattern, (match) => {
      const token = `@@PRESERVE_${preserved.length}@@`
      preserved.push(match)
      return token
    })
  }

  function restore(input: string): string {
    return input.replace(/@@PRESERVE_(\d+)@@/g, (_, index) => preserved[Number(index)] ?? '')
  }

  const withoutCode = preserve(preserve(text, /```[\s\S]*?```/g), /`[^`]*`/g)

  const stripped = withoutCode
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold **
    .replace(/__([^_]+)__/g, '$1') // Bold __
    .replace(/\*([^*]+)\*/g, '$1') // Italic *
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1') // Italic _
    .replace(/~~([^~]+)~~/g, '$1') // Strikethrough
    .replace(/^#{1,6}\s*/gm, '') // Headers
    .replace(/^\s*>+\s?/gm, '') // Blockquotes
    .replace(/^\s*[-*]\s+/gm, '') // Unordered lists
    .replace(/^\s*\d+\.\s+/gm, '') // Ordered lists
    .replace(/^[-*]{3,}\s*$/gm, '') // Horizontal rules

  return restore(stripped)
}

/**
 * Replace delimited sections with a placeholder.
 * Handles both paired delimiters (open/close) and single-character delimiters.
 */
function replaceDelimited(
  input: string,
  openDelimiter: string,
  closeDelimiter: string,
  replacement: string,
): string {
  let result = ''
  let cursor = 0

  while (cursor < input.length) {
    const start = input.indexOf(openDelimiter, cursor)
    if (start === -1) {
      result += input.slice(cursor)
      break
    }

    const searchFrom = start + openDelimiter.length
    const end = input.indexOf(closeDelimiter, searchFrom)

    result += input.slice(cursor, start) + replacement

    if (end === -1) {
      break
    }

    cursor = end + closeDelimiter.length
  }

  return result
}

/**
 * Clean text for speech synthesis.
 * Removes code blocks/inline code (replacing with spoken placeholders),
 * strips markdown, and collapses whitespace.
 */
export function cleanTextForSpeech(text: string): string {
  const withoutCodeBlocks = replaceDelimited(text, '```', '```', ' code block ')
  const withoutInlineCode = replaceDelimited(withoutCodeBlocks, '`', '`', ' code ')

  return withoutInlineCode
    .split('\n')
    .map((line) => stripMarkdown(line))
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim()
}
