import { afterEach, describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { DEFAULT_CONFIG } from '../../types'
import type { createPipelineTask } from '../../pipeline/task'

afterEach(() => {
  mock.restore()
})

type ExpandResult =
  | { kind: 'prompt'; prompt: string }
  | { kind: 'builtin'; commandName: string; answer: string }
  | { kind: 'action'; commandName: string; action: string }

function createCommandsMock(expandSlashCommandInput: () => Promise<ExpandResult>) {
  return {
    expandSlashCommandInput,
    extractSlashCommandName: (line: string) => {
      const match = line.match(/^\/(\S*)/)
      return match ? (match[1] ?? '') : null
    },
    listAvailableSlashCommands: async () => [
      { name: 'commands', source: 'builtin' as const },
      { name: 'explain', source: 'project' as const },
      { name: 'explore', source: 'project' as const },
      { name: 'help', source: 'builtin' as const },
    ],
  }
}

/**
 * Build a fake task factory for usePipeline's `createTask` option. Injecting it
 * avoids mock.module on the task module — Bun can't un-mock a module mid-run, so
 * a wholesale task mock would leak into other test files (e.g. task.test.ts).
 */
function fakeTask(
  impl: Partial<ReturnType<typeof createPipelineTask>> = {},
): typeof createPipelineTask {
  return (() => ({
    updateConfig: () => {},
    onStateChange: () => () => {},
    cancel: () => {},
    pause: () => {},
    resume: () => {},
    repeatTts: async () => {},
    stopPlayback: () => {},
    run: async () => ({ entryId: 'entry-1', text: '', cancelled: false }),
    ...impl,
  })) as unknown as typeof createPipelineTask
}

async function importUsePipeline() {
  return await import('./usePipeline')
}

describe('usePipeline submit', () => {
  it('expands slash commands before starting the run', async () => {
    const events: string[] = []
    const taskRun = mock(async () => {
      events.push('run')
      return { entryId: 'entry-1', text: '', cancelled: false }
    })

    mock.module('../../services/commands', () =>
      createCommandsMock(async () => {
        events.push('expand')
        return { kind: 'prompt', prompt: 'Expanded explain prompt' }
      }),
    )

    const { usePipeline } = await importUsePipeline()

    const startEntryCalls: string[] = []
    let controls!: ReturnType<typeof usePipeline>

    function Harness() {
      controls = usePipeline({
        config: DEFAULT_CONFIG,
        activeModel: DEFAULT_CONFIG.llmModel,
        initialModel: DEFAULT_CONFIG.llmModel,
        createTask: fakeTask({ run: taskRun, stopPlayback: () => events.push('stop') }),
        onFrame: () => {},
        onSubmitBuiltin: () => {},
        onAction: () => {},
        onRunComplete: () => {},
        onStateChange: () => {},
        onSubmitError: () => {},
        onOpenFiles: () => {},
        startEntry: (query) => {
          startEntryCalls.push(query)
          return { entryId: 'entry-1', query }
        },
      })
      return null
    }

    const app = render(<Harness />)

    await controls.submit('/explain')

    expect(startEntryCalls).toEqual(['Expanded explain prompt'])
    expect(taskRun).toHaveBeenCalledWith('Expanded explain prompt', 'entry-1')
    expect(events).toEqual(['stop', 'expand', 'run'])

    app.unmount()
  })

  it('routes slash-command lookup failures to the local error handler', async () => {
    const taskRun = mock(async () => ({ entryId: 'entry-1', text: '', cancelled: false }))

    mock.module('../../services/commands', () =>
      createCommandsMock(async () => {
        throw new Error('Slash command "/explain" not found.')
      }),
    )

    const { usePipeline } = await importUsePipeline()

    const submitErrors: Array<{ query: string; message: string }> = []
    const startEntry = mock(() => ({ entryId: 'entry-1', query: 'should-not-run' }))
    let controls!: ReturnType<typeof usePipeline>

    function Harness() {
      controls = usePipeline({
        config: DEFAULT_CONFIG,
        activeModel: DEFAULT_CONFIG.llmModel,
        initialModel: DEFAULT_CONFIG.llmModel,
        createTask: fakeTask({ run: taskRun }),
        onFrame: () => {},
        onSubmitBuiltin: () => {},
        onAction: () => {},
        onRunComplete: () => {},
        onStateChange: () => {},
        onSubmitError: (query, message) => submitErrors.push({ query, message }),
        onOpenFiles: () => {},
        startEntry,
      })
      return null
    }

    const app = render(<Harness />)

    await controls.submit('/explain')

    expect(submitErrors).toEqual([
      { query: '/explain', message: 'Slash command "/explain" not found.' },
    ])
    expect(startEntry).not.toHaveBeenCalled()
    expect(taskRun).not.toHaveBeenCalled()

    app.unmount()
  })

  it('routes built-in slash commands to the local built-in handler', async () => {
    const taskRun = mock(async () => ({ entryId: 'entry-1', text: '', cancelled: false }))

    mock.module('../../services/commands', () =>
      createCommandsMock(async () => ({
        kind: 'builtin',
        commandName: 'commands',
        answer: 'Available slash commands',
      })),
    )

    const { usePipeline } = await importUsePipeline()

    const builtins: Array<{ query: string; answer: string }> = []
    const startEntry = mock(() => ({ entryId: 'entry-1', query: 'should-not-run' }))
    let controls!: ReturnType<typeof usePipeline>

    function Harness() {
      controls = usePipeline({
        config: DEFAULT_CONFIG,
        activeModel: DEFAULT_CONFIG.llmModel,
        initialModel: DEFAULT_CONFIG.llmModel,
        createTask: fakeTask({ run: taskRun }),
        onFrame: () => {},
        onSubmitBuiltin: (query, answer) => builtins.push({ query, answer }),
        onAction: () => {},
        onRunComplete: () => {},
        onStateChange: () => {},
        onSubmitError: () => {},
        onOpenFiles: () => {},
        startEntry,
      })
      return null
    }

    const app = render(<Harness />)

    await controls.submit('/commands')

    expect(builtins).toEqual([{ query: '/commands', answer: 'Available slash commands' }])
    expect(startEntry).not.toHaveBeenCalled()
    expect(taskRun).not.toHaveBeenCalled()

    app.unmount()
  })

  it('routes action slash commands to the action handler', async () => {
    const taskRun = mock(async () => ({ entryId: 'entry-1', text: '', cancelled: false }))

    mock.module('../../services/commands', () =>
      createCommandsMock(async () => ({
        kind: 'action',
        commandName: 'sessions',
        action: 'open-sessions',
      })),
    )

    const { usePipeline } = await importUsePipeline()

    const actions: string[] = []
    const startEntry = mock(() => ({ entryId: 'entry-1', query: 'should-not-run' }))
    let controls!: ReturnType<typeof usePipeline>

    function Harness() {
      controls = usePipeline({
        config: DEFAULT_CONFIG,
        activeModel: DEFAULT_CONFIG.llmModel,
        initialModel: DEFAULT_CONFIG.llmModel,
        createTask: fakeTask({ run: taskRun }),
        onFrame: () => {},
        onSubmitBuiltin: () => {},
        onAction: (action) => actions.push(action),
        onRunComplete: () => {},
        onStateChange: () => {},
        onSubmitError: () => {},
        onOpenFiles: () => {},
        startEntry,
      })
      return null
    }

    const app = render(<Harness />)

    await controls.submit('/sessions')

    expect(actions).toEqual(['open-sessions'])
    expect(startEntry).not.toHaveBeenCalled()
    expect(taskRun).not.toHaveBeenCalled()

    app.unmount()
  })

  it('routes /open to the editor handler without running or expanding', async () => {
    const taskRun = mock(async () => ({ entryId: 'entry-1', text: '', cancelled: false }))
    const expandSlash = mock(async () => ({ kind: 'prompt' as const, prompt: 'unused' }))

    mock.module('../../services/commands', () => createCommandsMock(expandSlash))

    const { usePipeline } = await importUsePipeline()

    const openArgs: string[] = []
    const startEntry = mock(() => ({ entryId: 'entry-1', query: 'should-not-run' }))
    let controls!: ReturnType<typeof usePipeline>

    function Harness() {
      controls = usePipeline({
        config: DEFAULT_CONFIG,
        activeModel: DEFAULT_CONFIG.llmModel,
        initialModel: DEFAULT_CONFIG.llmModel,
        createTask: fakeTask({ run: taskRun }),
        onFrame: () => {},
        onSubmitBuiltin: () => {},
        onAction: () => {},
        onRunComplete: () => {},
        onStateChange: () => {},
        onSubmitError: () => {},
        onOpenFiles: (args) => {
          openArgs.push(args)
        },
        startEntry,
      })
      return null
    }

    const app = render(<Harness />)

    await controls.submit('/open src/foo.ts:42')

    expect(openArgs).toEqual(['src/foo.ts:42'])
    expect(expandSlash).not.toHaveBeenCalled()
    expect(startEntry).not.toHaveBeenCalled()
    expect(taskRun).not.toHaveBeenCalled()

    app.unmount()
  })
})
