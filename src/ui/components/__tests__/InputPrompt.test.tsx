import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame } from '../../__tests__/test-utils'

mock.module('../../hooks/useAnimationFrame', () => ({
  useAnimationFrame: () => 0,
}))

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function importInputPrompt() {
  return await import(`../InputPrompt?input-prompt-test=${Date.now()}-${Math.random()}`)
}

async function createCommandFixture(commandNames: string[]) {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'orb-input-prompt-'))
  const projectPath = path.join(baseDir, 'project')
  const homeDir = path.join(baseDir, 'home')
  const projectCommandsDir = path.join(projectPath, '.orb', 'commands')

  await mkdir(projectCommandsDir, { recursive: true })
  await mkdir(homeDir, { recursive: true })

  await Promise.all(
    commandNames.map((commandName) =>
      writeFile(path.join(projectCommandsDir, `${commandName}.md`), `# ${commandName}\n`),
    ),
  )

  return {
    projectPath,
    homeDir,
    async cleanup() {
      await rm(baseDir, { force: true, recursive: true })
    },
  }
}

describe('InputPrompt', () => {
  it('submits a chunked paste as one prompt even before rerender', async () => {
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt state="idle" onSubmit={(value: string) => submitted.push(value)} />,
    )

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
    const { InputPrompt } = await importInputPrompt()
    const app = render(<InputPrompt state="idle" onSubmit={() => {}} />)

    app.stdin.write('[200~hello world[201~')
    await flush()

    expect(normalizeFrame(app.lastFrame())).toContain('hello world')
    expect(normalizeFrame(app.lastFrame())).not.toContain('[200~')
    expect(normalizeFrame(app.lastFrame())).not.toContain('[201~')

    app.unmount()
  })

  it('completes a slash-command prefix on Tab and submits the expanded name', async () => {
    const fixture = await createCommandFixture(['explain', 'explore'])
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt
        state="idle"
        onSubmit={(value: string) => submitted.push(value)}
        projectPath={fixture.projectPath}
        homeDir={fixture.homeDir}
      />,
    )
    await flush()

    app.stdin.write('/he')
    app.stdin.write('\t')
    app.stdin.write('\r')
    await flush()

    expect(submitted).toEqual(['/help'])

    app.unmount()
    await fixture.cleanup()
  })

  it('cycles through matches on repeated Tab for an ambiguous prefix', async () => {
    const fixture = await createCommandFixture(['explain', 'explore'])
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt
        state="idle"
        onSubmit={(value: string) => submitted.push(value)}
        projectPath={fixture.projectPath}
        homeDir={fixture.homeDir}
      />,
    )
    await flush()

    app.stdin.write('/exp')
    app.stdin.write('\t')
    app.stdin.write('\t')
    app.stdin.write('\r')
    await flush()

    expect(submitted).toEqual(['/explore'])

    app.unmount()
    await fixture.cleanup()
  })

  it('is a no-op when Tab is pressed on non-slash input', async () => {
    const fixture = await createCommandFixture(['explain', 'explore'])
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt
        state="idle"
        onSubmit={(value: string) => submitted.push(value)}
        projectPath={fixture.projectPath}
        homeDir={fixture.homeDir}
      />,
    )
    await flush()

    app.stdin.write('hello')
    app.stdin.write('\t')
    app.stdin.write('\r')
    await flush()

    expect(submitted).toEqual(['hello'])

    app.unmount()
    await fixture.cleanup()
  })

  it('resets desired column after a no-op horizontal move at the document start', async () => {
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt state="idle" onSubmit={(value: string) => submitted.push(value)} />,
    )

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

  it('notifies the app when the draft changes', async () => {
    const { InputPrompt } = await importInputPrompt()
    let editCount = 0
    const app = render(
      <InputPrompt state="idle" onSubmit={() => {}} onEdit={() => (editCount += 1)} />,
    )

    app.stdin.write('h')
    await flush()

    expect(editCount).toBe(1)

    app.unmount()
  })
})
