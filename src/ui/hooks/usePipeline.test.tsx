import { afterEach, describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { DEFAULT_CONFIG } from '../../types'

afterEach(() => {
  mock.restore()
})

function createCommandsMock(
  expandSlashCommandInput: () => Promise<
    { kind: 'prompt'; prompt: string } | { kind: 'builtin'; commandName: string; answer: string }
  >,
) {
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

    mock.module('../../pipeline/task', () => ({
      createPipelineTask: () => ({
        updateConfig: () => {},
        onStateChange: () => () => {},
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        repeatTts: async () => {},
        stopPlayback: () => {
          events.push('stop')
        },
        run: taskRun,
      }),
    }))

    mock.module('../../services/commands', () =>
      createCommandsMock(async () => {
        events.push('expand')
        return {
          kind: 'prompt',
          prompt: 'Expanded explain prompt',
        }
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
        onFrame: () => {},
        onSubmitBuiltin: () => {},
        onRunComplete: () => {},
        onStateChange: () => {},
        onSubmitError: () => {},
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

    mock.module('../../pipeline/task', () => ({
      createPipelineTask: () => ({
        updateConfig: () => {},
        onStateChange: () => () => {},
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        repeatTts: async () => {},
        stopPlayback: () => {},
        run: taskRun,
      }),
    }))

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
        onFrame: () => {},
        onSubmitBuiltin: () => {},
        onRunComplete: () => {},
        onStateChange: () => {},
        onSubmitError: (query, message) => submitErrors.push({ query, message }),
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

    mock.module('../../pipeline/task', () => ({
      createPipelineTask: () => ({
        updateConfig: () => {},
        onStateChange: () => () => {},
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        repeatTts: async () => {},
        stopPlayback: () => {},
        run: taskRun,
      }),
    }))

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
        onFrame: () => {},
        onSubmitBuiltin: (query, answer) => builtins.push({ query, answer }),
        onRunComplete: () => {},
        onStateChange: () => {},
        onSubmitError: () => {},
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
})
