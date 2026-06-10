import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { normalizeFrame, settle } from '../../__tests__/test-utils'

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
    await settle()

    expect(normalizeFrame(app.lastFrame())).toContain('hello world')
    expect(normalizeFrame(app.lastFrame())).not.toContain('[200~')
    expect(normalizeFrame(app.lastFrame())).not.toContain('[201~')

    app.unmount()
  })

  it('applies raw backspace bytes inside a batched input chunk', async () => {
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt state="idle" onSubmit={(value: string) => submitted.push(value)} />,
    )

    app.stdin.write('abc\u007fd')
    app.stdin.write('\r')
    await flush()

    expect(submitted).toEqual(['abd'])

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
    await settle()

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
    await settle()

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
    await settle()

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

async function createFileFixture(files: string[]) {
  const { invalidateFileList } = await import('../../../services/file-search')
  const base = await mkdtemp(path.join(tmpdir(), 'orb-input-mention-'))
  const projectPath = path.join(base, 'project')
  await mkdir(projectPath, { recursive: true })
  for (const file of files) {
    const abs = path.join(projectPath, file)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, '')
  }
  // A real git repo makes `git ls-files` return a deterministic sorted list.
  await Bun.spawn(['git', 'init', '-q'], {
    cwd: projectPath,
    stdout: 'ignore',
    stderr: 'ignore',
  }).exited
  invalidateFileList(projectPath)

  return {
    projectPath,
    async cleanup() {
      invalidateFileList(projectPath)
      await rm(base, { force: true, recursive: true })
    },
  }
}

describe('InputPrompt @-file menu', () => {
  it('opens after @ and inserts the selected path on Enter, then submits', async () => {
    const fixture = await createFileFixture(['src/alpha.ts', 'src/beta.ts'])
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt
        state="idle"
        onSubmit={(value: string) => submitted.push(value)}
        projectPath={fixture.projectPath}
      />,
    )
    await flush()

    app.stdin.write('look at @al')
    await settle()
    expect(normalizeFrame(app.lastFrame())).toContain('src/alpha.ts')

    app.stdin.write('\r') // Enter accepts the highlighted item
    await settle()
    app.stdin.write('\r') // now Enter submits the message
    await settle()

    expect(submitted).toEqual(['look at src/alpha.ts'])

    app.unmount()
    await fixture.cleanup()
  })

  it('accepts the selection on Tab', async () => {
    const fixture = await createFileFixture(['src/alpha.ts'])
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt
        state="idle"
        onSubmit={(value: string) => submitted.push(value)}
        projectPath={fixture.projectPath}
      />,
    )
    await flush()

    app.stdin.write('@al')
    await settle()
    app.stdin.write('\t') // Tab accepts
    await settle()
    app.stdin.write('\r')
    await settle()

    expect(submitted).toEqual(['src/alpha.ts'])

    app.unmount()
    await fixture.cleanup()
  })

  it('navigates with the down arrow before accepting', async () => {
    const fixture = await createFileFixture(['src/aaa.ts', 'src/aab.ts'])
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt
        state="idle"
        onSubmit={(value: string) => submitted.push(value)}
        projectPath={fixture.projectPath}
      />,
    )
    await flush()

    app.stdin.write('@aa')
    await settle()
    app.stdin.write('\x1b[B') // down arrow -> second item (sorted: aab)
    await settle()
    app.stdin.write('\r') // accept
    await settle()
    app.stdin.write('\r') // submit
    await settle()

    expect(submitted).toEqual(['src/aab.ts'])

    app.unmount()
    await fixture.cleanup()
  })

  it('dismisses on Esc, leaving the literal text so Enter submits it', async () => {
    const fixture = await createFileFixture(['src/alpha.ts'])
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt
        state="idle"
        onSubmit={(value: string) => submitted.push(value)}
        projectPath={fixture.projectPath}
      />,
    )
    await flush()

    app.stdin.write('@al')
    await settle()
    app.stdin.write('\x1b') // Esc dismisses the menu
    await settle()
    expect(normalizeFrame(app.lastFrame())).not.toContain('select')

    app.stdin.write('\r') // Enter now submits the raw text
    await settle()

    expect(submitted).toEqual(['@al'])

    app.unmount()
    await fixture.cleanup()
  })

  it('submits normally when the query matches no files', async () => {
    const fixture = await createFileFixture(['src/alpha.ts'])
    const { InputPrompt } = await importInputPrompt()
    const submitted: string[] = []
    const app = render(
      <InputPrompt
        state="idle"
        onSubmit={(value: string) => submitted.push(value)}
        projectPath={fixture.projectPath}
      />,
    )
    await flush()

    app.stdin.write('@zzzzz')
    await settle()
    expect(normalizeFrame(app.lastFrame())).not.toContain('select')

    app.stdin.write('\r')
    await settle()

    expect(submitted).toEqual(['@zzzzz'])

    app.unmount()
    await fixture.cleanup()
  })
})

describe('InputPrompt mention-search guard', () => {
  it('does not call searchProjectFiles when no @ is present', async () => {
    let callCount = 0
    mock.module('../../../services/file-search', () => ({
      searchProjectFiles: async () => {
        callCount++
        return []
      },
      invalidateFileList: () => {},
      listProjectFiles: async () => [],
    }))

    const { InputPrompt } = await importInputPrompt()
    const app = render(<InputPrompt state="idle" onSubmit={() => {}} projectPath="/fake/path" />)
    await flush()

    app.stdin.write('hello world this is normal typing without any mention')
    await settle()

    expect(callCount).toBe(0)
    app.unmount()
  })
})
