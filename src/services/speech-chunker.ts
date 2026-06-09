export const STRONG_BOUNDARY = /[.!?]+["')\]]*(?:\s|$)/g
export const SOFT_BOUNDARY = /[,;:](?:\s|$)/g

export function findLastMatchIndex(text: string, re: RegExp): number {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  const pattern = new RegExp(re.source, flags)
  let lastIndex = -1

  while (pattern.exec(text) !== null) {
    lastIndex = pattern.lastIndex
  }

  return lastIndex
}

export function findLastWhitespaceIndex(text: string): number {
  const lastSpace = Math.max(text.lastIndexOf(' '), text.lastIndexOf('\t'), text.lastIndexOf('\n'))
  return lastSpace >= 0 ? lastSpace + 1 : -1
}

export function extractStrongChunks(text: string): { chunks: string[]; consumed: number } {
  const chunks: string[] = []
  const pattern = new RegExp(STRONG_BOUNDARY.source, STRONG_BOUNDARY.flags)
  let lastIndex = 0

  while (pattern.exec(text) !== null) {
    const end = pattern.lastIndex
    const slice = text.slice(lastIndex, end)
    const trimmed = slice.trimEnd()
    if (trimmed.trim()) {
      chunks.push(trimmed)
    }
    lastIndex = end
  }

  return { chunks, consumed: lastIndex }
}

export function extractChunkAtBoundary(
  text: string,
  boundary: number,
  minLength: number,
  forceFlush: boolean,
): { chunk: string | null; consumed: number } {
  if (boundary <= 0) return { chunk: null, consumed: 0 }

  const trimmed = text.slice(0, boundary).trimEnd()
  const hasContent = trimmed.trim().length > 0
  const meetsMinLength = forceFlush || minLength <= 0 || trimmed.trim().length >= minLength

  if (!hasContent || !meetsMinLength) {
    return { chunk: null, consumed: 0 }
  }

  return { chunk: trimmed, consumed: boundary }
}
