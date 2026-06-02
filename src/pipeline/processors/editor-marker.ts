import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { Processor } from '../processor'
import { parseFileRefs, type FileRef } from '../../services/file-refs'

export interface EditorMarkerOptions {
  /** Called once per turn with the parsed refs of every complete `orb:open` block. */
  open: (refs: FileRef[]) => void
  /** Fence info-string that marks an open block. Defaults to `orb:open`. */
  fenceLabel?: string
}

/** An open markdown code fence we're currently inside (its char run + length). */
interface FenceState {
  char: string
  len: number
}

interface FenceLine {
  char: string
  len: number
  info: string
}

/**
 * Parse a line's leading code-fence run (``` or ~~~), if any. Per CommonMark a
 * fence may be indented at most 3 spaces; 4+ spaces (or a tab) is an indented
 * code block, not a fence.
 */
function fenceLine(raw: string): FenceLine | null {
  const match = raw.match(/^( {0,3})([`~])\2{2,}([^\n]*)$/)
  if (!match) return null
  const char = match[2]!
  const afterIndent = raw.slice(match[1]!.length)
  let len = 0
  while (afterIndent[len] === char) len++
  return { char, len, info: afterIndent.slice(len).trim() }
}

/** Is `raw` a closing fence for the currently-open `fence` (same char, >= length, no info)? */
function closesFence(raw: string, fence: FenceState): boolean {
  const parsed = fenceLine(raw)
  return !!parsed && parsed.char === fence.char && parsed.len >= fence.len && parsed.info === ''
}

/**
 * EditorMarkerProcessor: a "control frame, not content" seam.
 *
 * The model can emit a fenced block to point the user's editor at files:
 *
 *   ```orb:open
 *   src/pipeline/adapters/openai.ts:42
 *   ```
 *
 * This processor sits between the agent and TTS processors. Because TTS passes
 * frames through and the UI/session read the pipeline's final output, stripping
 * the block here removes it from speech, the visible transcript, and the saved
 * conversation in one place.
 *
 * Two text paths flow through, and both are scrubbed identically:
 *
 *  - The streamed `agent-text-delta` frames feed live rendering and streaming
 *    TTS. Here we work line-by-line, holding only the current partial line while
 *    it could still be the start of an `orb:open` fence, so a partial marker can
 *    never reach the speaker or the screen mid-stream. No side effects fire here.
 *  - The terminating `agent-text-complete.text` is the canonical answer (some
 *    adapters send a final string that differs from the deltas, or send no
 *    deltas at all). We re-scrub it from scratch and treat it as the single
 *    source of truth: it is what we emit, and the blocks found in it are what
 *    trigger the editor — exactly once per turn.
 *
 * An `orb:open` fence is only a control block when it appears at the top level —
 * an `orb:open` shown *inside* an ordinary (or longer) code fence is treated as
 * literal content, so explaining the marker syntax never opens files.
 *
 * Fail-closed: a block only triggers the editor when it is well-formed and
 * properly closed. An unterminated or unparseable block is dropped from the
 * text and opens nothing.
 */
export function createEditorMarkerProcessor(options: EditorMarkerOptions): Processor {
  const label = (options.fenceLabel ?? 'orb:open').toLowerCase()
  const openFence = '```' + label

  // A control opener is strict: column 0, exactly three backticks, the label,
  // and only trailing whitespace. Anything looser (indented, longer fence,
  // nested) is ordinary content, so the live and final paths agree and showing
  // the marker syntax never triggers an open.
  const isControlOpener = (raw: string): boolean =>
    raw.replace(/\s+$/, '').toLowerCase() === openFence

  // The fence opened by a control opener: always three backticks.
  const controlFence: FenceState = { char: '`', len: 3 }

  /**
   * Strip every well-formed top-level `orb:open` block from a complete piece of
   * text, returning the cleaned text and the refs collected from those blocks.
   * Ordinary code fences are tracked so a nested `orb:open` stays as content; an
   * unterminated trailing control block is dropped without contributing refs.
   */
  const stripBlocks = (text: string): { text: string; refs: FileRef[] } => {
    const lines = text.split('\n')
    const kept: string[] = []
    const refs: FileRef[] = []
    let normalFence: FenceState | null = null

    let i = 0
    while (i < lines.length) {
      const current = lines[i] ?? ''

      if (normalFence) {
        kept.push(current)
        if (closesFence(current, normalFence)) normalFence = null
        i++
        continue
      }

      if (isControlOpener(current)) {
        let j = i + 1
        while (j < lines.length && !closesFence(lines[j] ?? '', controlFence)) j++
        if (j >= lines.length) break // unterminated: fail closed, drop the rest
        for (let k = i + 1; k < j; k++) refs.push(...parseFileRefs(lines[k] ?? ''))
        i = j + 1
        continue
      }

      const parsed = fenceLine(current)
      if (parsed) normalFence = { char: parsed.char, len: parsed.len }
      kept.push(current)
      i++
    }

    return { text: kept.join('\n'), refs }
  }

  return async function* editorMarkerProcessor(
    upstream: AsyncIterable<Frame>,
  ): AsyncGenerator<Frame> {
    let cleaned = '' // mirror of the cleaned delta text emitted so far
    let normalFence: FenceState | null = null
    let markerFence: FenceState | null = null // set while inside a control block
    let line = '' // current partial line (since the last newline)
    let lineEmitted = 0 // chars of `line` already streamed downstream

    // Could `partial` still grow into a control opener? Strict (column 0): true
    // while it is a prefix of "```<label>", or already that followed by spaces.
    const couldBeOpenFence = (partial: string): boolean => {
      const text = partial.toLowerCase()
      if (text.length === 0) return false
      if (openFence.startsWith(text)) return true
      if (text.startsWith(openFence)) return /^\s*$/.test(text.slice(openFence.length))
      return false
    }

    // Strip markers from the live delta stream for rendering + streaming TTS.
    // Side effects are deliberately deferred to the complete frame.
    const completeLine = (): string => {
      let emit = ''
      if (markerFence) {
        if (closesFence(line, markerFence)) markerFence = null
      } else if (normalFence) {
        emit = line.slice(lineEmitted) + '\n'
        if (closesFence(line, normalFence)) normalFence = null
      } else if (isControlOpener(line)) {
        markerFence = controlFence
      } else {
        const parsed = fenceLine(line)
        if (parsed) normalFence = { char: parsed.char, len: parsed.len }
        emit = line.slice(lineEmitted) + '\n'
      }
      line = ''
      lineEmitted = 0
      return emit
    }

    const consume = (text: string): string => {
      let emit = ''
      for (const ch of text) {
        if (ch === '\n') {
          emit += completeLine()
          continue
        }
        line += ch
        // Hold the partial line only when it could still open a control block;
        // inside a normal fence (or plain text) it streams through immediately.
        const mightOpenControl = !normalFence && couldBeOpenFence(line)
        if (!markerFence && !mightOpenControl) {
          emit += line.slice(lineEmitted)
          lineEmitted = line.length
        }
      }
      return emit
    }

    const reset = () => {
      cleaned = ''
      normalFence = null
      markerFence = null
      line = ''
      lineEmitted = 0
    }

    for await (const frame of upstream) {
      if (frame.kind === 'agent-text-delta') {
        const emit = consume(frame.delta)
        if (emit) {
          cleaned += emit
          yield createFrame('agent-text-delta', { delta: emit, accumulatedText: cleaned })
        }
        continue
      }

      if (frame.kind === 'agent-text-complete') {
        const stripped = stripBlocks(frame.text)
        if (stripped.refs.length > 0) options.open(stripped.refs)
        yield createFrame('agent-text-complete', { text: stripped.text, session: frame.session })
        reset()
        continue
      }

      yield frame
    }
  }
}
