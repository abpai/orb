import type { Frame } from '../frames'
import { createFrame } from '../frames'
import type { Processor } from '../processor'
import { parseFileRefs, type FileRef } from '../../services/file-refs'

interface EditorMarkerOptions {
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
 * How a single line is classified by the shared fence machine. The caller maps
 * each verdict to a path-specific action (emit/hold for streaming, keep/collect
 * for batch), but the classification itself — and the state transitions behind
 * it — live in exactly one place so the two paths cannot drift.
 *
 *  - `content`: ordinary text (prose or any non-control fence line). Kept.
 *  - `control-open`: the strict top-level `orb:open` opener. Dropped.
 *  - `control-body`: a line inside an open control block. Dropped; carries refs.
 *  - `control-close`: the fence that closes an open control block. Dropped.
 */
type LineKind = 'content' | 'control-open' | 'control-body' | 'control-close'

interface FenceMachine {
  /** Classify `line` and advance the fence state. */
  feedLine: (line: string) => LineKind
  /** True while inside an open control block (its lines are dropped). */
  readonly inControlBlock: boolean
  /** True while inside an ordinary code fence (its lines are kept as content). */
  readonly inNormalFence: boolean
}

/**
 * The single fence state machine shared by both scrub paths. It tracks the one
 * open code fence (if any) and whether we are inside a control block, and turns
 * each fed line into a {@link LineKind}. Per turn the caller creates a fresh
 * machine; the streaming path holds one across deltas, the batch path drives a
 * throwaway one over the complete text. Because the transition table lives here
 * once, a top-level `orb:open` is recognized — and a nested one ignored —
 * identically in both.
 */
function createFenceMachine(
  isControlOpener: (raw: string) => boolean,
  controlFence: FenceState,
): FenceMachine {
  let normalFence: FenceState | null = null
  let markerFence: FenceState | null = null // set while inside a control block

  return {
    get inControlBlock() {
      return markerFence !== null
    },
    get inNormalFence() {
      return normalFence !== null
    },
    feedLine(line: string): LineKind {
      if (markerFence) {
        // Inside a control block: every line is dropped; the close ends it.
        if (closesFence(line, markerFence)) {
          markerFence = null
          return 'control-close'
        }
        return 'control-body'
      }
      if (normalFence) {
        // Inside an ordinary fence: keep content; a nested `orb:open` is literal.
        if (closesFence(line, normalFence)) normalFence = null
        return 'content'
      }
      if (isControlOpener(line)) {
        markerFence = controlFence
        return 'control-open'
      }
      const parsed = fenceLine(line)
      if (parsed) normalFence = { char: parsed.char, len: parsed.len }
      return 'content'
    },
  }
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
 * Two text paths flow through, and both are scrubbed identically — by sharing a
 * single fence state machine ({@link createFenceMachine}), so the line
 * classification can never drift between them:
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
   *
   * Drives the shared {@link createFenceMachine} line by line: `content` lines
   * are kept, control-block lines are dropped, and `control-body` lines feed
   * `parseFileRefs`. Refs are buffered per block so an unterminated trailing
   * block (machine still `inControlBlock` after the last line) drops everything
   * since its opener and contributes no refs — the fail-closed invariant.
   */
  const stripBlocks = (text: string): { text: string; refs: FileRef[] } => {
    const lines = text.split('\n')
    const kept: string[] = []
    const refs: FileRef[] = []
    let pending: FileRef[] = [] // refs of the control block currently open
    const machine = createFenceMachine(isControlOpener, controlFence)

    for (const current of lines) {
      switch (machine.feedLine(current)) {
        case 'content':
          kept.push(current)
          break
        case 'control-open':
          pending = []
          break
        case 'control-body':
          pending.push(...parseFileRefs(current))
          break
        case 'control-close':
          refs.push(...pending)
          pending = []
          break
      }
    }
    // Unterminated trailing block: its lines were already dropped above and its
    // buffered refs in `pending` are discarded, so it opens nothing.

    return { text: kept.join('\n'), refs }
  }

  return async function* editorMarkerProcessor(
    upstream: AsyncIterable<Frame>,
  ): AsyncGenerator<Frame> {
    let cleaned = '' // mirror of the cleaned delta text emitted so far
    let machine = createFenceMachine(isControlOpener, controlFence)
    let line = '' // current partial line (since the last newline)
    let lineEmitted = 0 // chars of `line` already streamed downstream

    // Could `partial` still grow into a control opener? Strict (column 0): true
    // while it is a prefix of "```<label>", or already that followed by spaces.
    const couldBeOpenFence = (partial: string): boolean => {
      // A control opener always starts with a backtick, so a line whose first
      // char isn't one can never grow into one. Bail before lowercasing the
      // whole partial line — otherwise a long backtick-free line costs O(n²)
      // (one full-line toLowerCase per streamed char).
      if (partial.charCodeAt(0) !== 96 /* ` */) return false
      const text = partial.toLowerCase()
      if (text.length === 0) return false
      if (openFence.startsWith(text)) return true
      if (text.startsWith(openFence)) return /^\s*$/.test(text.slice(openFence.length))
      return false
    }

    // Finish the current line: classify it through the shared machine and emit
    // its still-unstreamed tail only when it is plain `content`. Control-block
    // lines (opener, body, close) emit nothing — their stripping is what keeps a
    // marker off the speaker and screen. Side effects are deferred to the
    // complete frame, so refs from `control-body` are ignored here.
    const completeLine = (): string => {
      const emit = machine.feedLine(line) === 'content' ? line.slice(lineEmitted) + '\n' : ''
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
        const mightOpenControl = !machine.inNormalFence && couldBeOpenFence(line)
        if (!machine.inControlBlock && !mightOpenControl) {
          emit += line.slice(lineEmitted)
          lineEmitted = line.length
        }
      }
      return emit
    }

    const reset = () => {
      cleaned = ''
      machine = createFenceMachine(isControlOpener, controlFence)
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
        yield createFrame('agent-text-complete', { text: stripped.text })
        reset()
        continue
      }

      yield frame
    }
  }
}
