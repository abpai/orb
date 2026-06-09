/**
 * Is a code delimiter left open in `text`? An unclosed ``` fence or inline `
 * makes earlier cleaning non-final — closing it later retroactively rewrites
 * the text (see cleanTextForSpeech) — so the buffer prefix is not yet settled
 * and must not be compacted away. Mirrors replaceDelimited's non-overlapping
 * pairing: count ``` fences first, then inline backticks in the fence-free
 * remainder.
 */
export function hasOpenCodeDelimiter(text: string): boolean {
  let fences = 0
  let index = text.indexOf('```')
  while (index !== -1) {
    fences += 1
    index = text.indexOf('```', index + 3)
  }
  if (fences % 2 !== 0) return true
  const inlineTicks = (text.replace(/```/g, '').match(/`/g) ?? []).length
  return inlineTicks % 2 !== 0
}

export function splitIntoSentences(text: string): string[] {
  const sentences: string[] = []
  let current = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === undefined) continue

    current += char

    if (['.', '!', '?'].includes(char)) {
      const next = text[i + 1]
      if (next === undefined || next === ' ' || next === '\n') {
        const trimmed = current.trim()
        if (trimmed.length > 0) {
          sentences.push(trimmed)
        }
        current = ''
      }
    }
  }

  const trimmed = current.trim()
  if (trimmed.length > 0) {
    sentences.push(trimmed)
  }

  return sentences
}
