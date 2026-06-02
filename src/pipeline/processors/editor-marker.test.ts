import { describe, expect, it } from 'bun:test'
import { createEditorMarkerProcessor } from './editor-marker'
import { createFrame, resetFrameIds, type Frame } from '../frames'
import type { FileRef } from '../../services/file-refs'

async function* fromArray(frames: Frame[]): AsyncGenerator<Frame> {
  for (const frame of frames) yield frame
}

/** Build a delta frame stream from raw chunks plus a terminating complete frame. */
function textStream(chunks: string[]): Frame[] {
  const frames: Frame[] = chunks.map((delta) =>
    createFrame('agent-text-delta', { delta, accumulatedText: '' }),
  )
  frames.push(createFrame('agent-text-complete', { text: chunks.join('') }))
  return frames
}

async function run(
  chunks: string[],
): Promise<{ text: string; deltas: string[]; opened: FileRef[][] }> {
  resetFrameIds()
  const opened: FileRef[][] = []
  const processor = createEditorMarkerProcessor({ open: (refs) => opened.push(refs) })

  const deltas: string[] = []
  let text = ''
  for await (const frame of processor(fromArray(textStream(chunks)))) {
    if (frame.kind === 'agent-text-delta') deltas.push(frame.delta)
    if (frame.kind === 'agent-text-complete') text = frame.text
  }
  return { text, deltas, opened }
}

describe('createEditorMarkerProcessor', () => {
  it('passes ordinary prose through unchanged', async () => {
    const { text, opened } = await run(['Hello there, ', 'this is fine.'])
    expect(text).toBe('Hello there, this is fine.')
    expect(opened).toEqual([])
  })

  it('keeps accumulatedText consistent with the emitted deltas', async () => {
    resetFrameIds()
    const processor = createEditorMarkerProcessor({ open: () => {} })
    let lastAccumulated = ''
    let concatDeltas = ''
    for await (const frame of processor(fromArray(textStream(['ab', 'cd', 'ef'])))) {
      if (frame.kind === 'agent-text-delta') {
        concatDeltas += frame.delta
        lastAccumulated = frame.accumulatedText
      }
    }
    expect(lastAccumulated).toBe('abcdef')
    expect(concatDeltas).toBe('abcdef')
  })

  it('strips a complete orb:open block and fires open with parsed refs', async () => {
    const { text, opened } = await run([
      'Opening it for you.\n',
      '```orb:open\n',
      'src/foo.ts:42\n',
      'lib/bar.ts\n',
      '```\n',
      'Anything else?',
    ])
    expect(text).toBe('Opening it for you.\nAnything else?')
    expect(opened).toEqual([[{ path: 'src/foo.ts', line: 42 }, { path: 'lib/bar.ts' }]])
  })

  it('handles a marker split across delta boundaries mid-fence and mid-path', async () => {
    const { text, opened } = await run([
      'before\n``',
      '`orb:',
      'open\nsrc/a',
      '.ts:7\n``',
      '`\nafter',
    ])
    expect(text).toBe('before\nafter')
    expect(opened).toEqual([[{ path: 'src/a.ts', line: 7 }]])
  })

  it('preserves a normal code fence that is not an orb:open block', async () => {
    const { text, opened } = await run(['```ts\n', 'const x = 1\n', '```\n', 'done'])
    expect(text).toBe('```ts\nconst x = 1\n```\ndone')
    expect(opened).toEqual([])
  })

  it('treats an orb:open shown inside a longer code fence as literal content', async () => {
    const doc = '````markdown\n```orb:open\nx.ts\n```\n````'
    const { text, opened } = await run([doc])
    expect(text).toBe(doc)
    expect(opened).toEqual([])
  })

  it('does not treat an indented orb:open as a control block', async () => {
    const doc = '    ```orb:open\n    x.ts\n    ```'
    const { text, opened } = await run([doc])
    expect(text).toBe(doc)
    expect(opened).toEqual([])
  })

  it('does not treat a longer ````orb:open fence as a control block', async () => {
    const doc = '````orb:open\nx.ts\n````'
    const { text, opened } = await run([doc])
    expect(text).toBe(doc)
    expect(opened).toEqual([])
  })

  it('fails closed on an unterminated block: drops it and opens nothing', async () => {
    const { text, opened } = await run(['see this\n', '```orb:open\n', 'src/x.ts\n'])
    expect(text).toBe('see this')
    expect(opened).toEqual([])
  })

  it('uses agent-text-complete.text as the source of truth when there are no deltas', async () => {
    resetFrameIds()
    const opened: FileRef[][] = []
    const processor = createEditorMarkerProcessor({ open: (refs) => opened.push(refs) })
    const frames: Frame[] = [
      createFrame('agent-text-complete', { text: 'Hello\n```orb:open\nsrc/a.ts\n```\nbye' }),
    ]
    let text = ''
    for await (const frame of processor(fromArray(frames))) {
      if (frame.kind === 'agent-text-complete') text = frame.text
    }
    expect(text).toBe('Hello\nbye')
    expect(opened).toEqual([[{ path: 'src/a.ts' }]])
  })

  it('preserves complete-only text that has no marker', async () => {
    resetFrameIds()
    const opened: FileRef[][] = []
    const processor = createEditorMarkerProcessor({ open: (refs) => opened.push(refs) })
    const frames: Frame[] = [createFrame('agent-text-complete', { text: 'just final text' })]
    let text = ''
    for await (const frame of processor(fromArray(frames))) {
      if (frame.kind === 'agent-text-complete') text = frame.text
    }
    expect(text).toBe('just final text')
    expect(opened).toEqual([])
  })

  it('collects refs from multiple blocks in one turn and opens once', async () => {
    resetFrameIds()
    const opened: FileRef[][] = []
    const processor = createEditorMarkerProcessor({ open: (refs) => opened.push(refs) })
    const frames: Frame[] = [
      createFrame('agent-text-complete', {
        text: '```orb:open\na.ts\n```\nand\n```orb:open\nb.ts:3\n```',
      }),
    ]
    for await (const _frame of processor(fromArray(frames))) {
      // drain
    }
    expect(opened).toEqual([[{ path: 'a.ts' }, { path: 'b.ts', line: 3 }]])
  })

  it('drops a bare orb:open header with no body and opens nothing', async () => {
    const { text, opened } = await run(['intro\n', '```orb:open'])
    expect(text).toBe('intro')
    expect(opened).toEqual([])
  })

  it('does not open when the block has no valid file refs', async () => {
    const { text, opened } = await run(['```orb:open\n', 'not a path at all\n', '```\n'])
    expect(text).toBe('')
    expect(opened).toEqual([])
  })

  it('passes non-text frames through untouched', async () => {
    resetFrameIds()
    const processor = createEditorMarkerProcessor({ open: () => {} })
    const toolFrame = createFrame('tool-call-start', {
      toolCall: { id: 't', name: 'Read', input: {}, status: 'running' },
    })
    const frames: Frame[] = [toolFrame, createFrame('agent-text-complete', { text: '' })]
    const kinds: string[] = []
    for await (const frame of processor(fromArray(frames))) kinds.push(frame.kind)
    expect(kinds).toContain('tool-call-start')
  })
})
