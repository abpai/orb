import { afterEach, describe, expect, it, mock } from 'bun:test'
import { render } from 'ink-testing-library'

import { DEFAULT_CONFIG } from '../../types'

afterEach(() => {
  mock.restore()
})

async function importUsePipeline() {
  return await import('./usePipeline')
}

describe('usePipeline submit', () => {
  it('expands slash commands before starting the run', async () => {
    const taskRun = mock(async () => ({ entryId: 'entry-1', text: '', cancelled: false }))

    mock.module('../../pipeline/task', () => ({
      createPipelineTask: () => ({
        updateConfig: () => {},
        onStateChange: () => () => {},
        cancel: () => {},
        pause: () => {},
        resume: () => {},
        repeatTts: async () => {},
        run: taskRun,
      }),
    }))

    mock.module('../../services/commands', () => ({
      expandSlashCommandInput: async () => ({ prompt: 'Expanded explain prompt' }),
    }))

    const { usePipeline } = await importUsePipeline()

    const startEntryCalls: string[] = []
    let controls!: ReturnType<typeof usePipeline>

    function Harness() {
      controls = usePipeline({
        config: DEFAULT_CONFIG,
        activeModel: DEFAULT_CONFIG.llmModel,
        initialModel: DEFAULT_CONFIG.llmModel,
        onFrame: () => {},
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
        run: taskRun,
      }),
    }))

    mock.module('../../services/commands', () => ({
      expandSlashCommandInput: async () => {
        throw new Error('Slash command "/explain" not found.')
      },
    }))

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
})
