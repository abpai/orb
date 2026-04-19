import { describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame } from '../../__tests__/test-utils'

mock.module('../../hooks/useAnimationFrame', () => ({
  useAnimationFrame: () => 0,
}))

import { InputPrompt } from '../InputPrompt'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('InputPrompt', () => {
  it('submits a chunked paste as one prompt even before rerender', async () => {
    const submitted: string[] = []
    const app = render(<InputPrompt state="idle" onSubmit={(value) => submitted.push(value)} />)

    app.stdin.write('Explain, in three paragraphs, what a monad is. Use a different a')
    app.stdin.write('nalogy in each paragraph.')
    app.stdin.write('\r')
    await flush()

    expect(submitted).toEqual([
      'Explain, in three paragraphs, what a monad is. Use a different analogy in each paragraph.',
    ])

    app.unmount()
  })

  it('strips ESC-less bracketed paste markers before inserting text', async () => {
    const app = render(<InputPrompt state="idle" onSubmit={() => {}} />)

    app.stdin.write('[200~hello world[201~')
    await flush()

    expect(normalizeFrame(app.lastFrame())).toContain('hello world')
    expect(normalizeFrame(app.lastFrame())).not.toContain('[200~')
    expect(normalizeFrame(app.lastFrame())).not.toContain('[201~')

    app.unmount()
  })

  it('resets desired column after a no-op horizontal move at the document start', async () => {
    const submitted: string[] = []
    const app = render(<InputPrompt state="idle" onSubmit={(value) => submitted.push(value)} />)

    app.stdin.write('abcdefghij\nxy')
    app.stdin.write('\x1b[A')
    app.stdin.write('\x1b[H')
    app.stdin.write('\x1b[D')
    app.stdin.write('\x1b[B')
    app.stdin.write('Z')
    app.stdin.write('\r')
    await flush()

    expect(submitted).toEqual(['abcdefghij\nZxy'])

    app.unmount()
  })
})
