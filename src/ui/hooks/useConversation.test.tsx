import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { render } from 'ink-testing-library'

import { ANTHROPIC_MODELS, DEFAULT_CONFIG } from '../../types'
import { getSessionPath, loadSession } from '../../services/session'
import type { RunResult } from '../../pipeline/task'
import type { OutboundFrame } from '../../pipeline/transports/types'
import { useConversation } from './useConversation'

function makeConfig(projectPath: string) {
  return { ...DEFAULT_CONFIG, projectPath }
}

function makeRunResult(entryId: string, overrides?: Partial<RunResult>): RunResult {
  return { entryId, text: '', cancelled: false, ...overrides }
}

let frameSeq = 0
function frame(partial: Record<string, unknown>): OutboundFrame {
  return { id: ++frameSeq, timestamp: Date.now(), ...partial } as OutboundFrame
}

/** Let React flush state updates. */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('useConversation', () => {
  const cleanupPaths = new Set<string>()

  afterEach(async () => {
    for (const cleanupPath of cleanupPaths) {
      await rm(cleanupPath, { recursive: true, force: true })
    }
    cleanupPaths.clear()
  })

  it('persists model changes before the first message', async () => {
    const tempProjectRoot = await mkdtemp(path.join(tmpdir(), 'orb-use-conversation-'))
    cleanupPaths.add(tempProjectRoot)

    const projectPath = path.join(tempProjectRoot, 'project')
    await mkdir(projectPath, { recursive: true })

    const sessionPath = getSessionPath(projectPath)
    cleanupPaths.add(sessionPath)

    let controls!: ReturnType<typeof useConversation>

    function Harness() {
      controls = useConversation({
        config: makeConfig(projectPath),
        initialSession: null,
        taskState: 'idle',
      })

      return null
    }

    const app = render(<Harness />)

    // Verify new return shape
    expect(controls.completedTurns).toEqual([])
    expect(controls.liveTurn).toBeNull()

    controls.cycleModel()
    await new Promise((resolve) => setTimeout(resolve, 20))

    app.unmount()

    const saved = await loadSession(projectPath)
    expect(saved).not.toBeNull()
    expect(saved?.llmModel).toBe(ANTHROPIC_MODELS[1])
    expect(saved?.history).toEqual([])
  })

  describe('cancel handling', () => {
    it('archives partial turn on cancel', async () => {
      let controls!: ReturnType<typeof useConversation>

      function Harness() {
        controls = useConversation({
          config: makeConfig('/tmp/cancel-test'),
          initialSession: null,
          taskState: 'processing',
        })
        return null
      }

      const app = render(<Harness />)

      const pending = controls.startEntry('test question')
      expect(pending).not.toBeNull()
      await flush()
      expect(controls.liveTurn).not.toBeNull()

      controls.handleRunComplete(makeRunResult(pending!.entryId, { cancelled: true }))
      await flush()

      expect(controls.liveTurn).toBeNull()
      expect(controls.completedTurns).toHaveLength(1)
      expect(controls.completedTurns[0]?.question).toBe('test question')

      app.unmount()
    })

    it('does not persist session on cancelled run', async () => {
      const tempProjectRoot = await mkdtemp(path.join(tmpdir(), 'orb-cancel-persist-'))
      cleanupPaths.add(tempProjectRoot)

      const projectPath = path.join(tempProjectRoot, 'project')
      await mkdir(projectPath, { recursive: true })

      const sessionPath = getSessionPath(projectPath)
      cleanupPaths.add(sessionPath)

      let controls!: ReturnType<typeof useConversation>

      function Harness() {
        controls = useConversation({
          config: makeConfig(projectPath),
          initialSession: null,
          taskState: 'processing',
        })
        return null
      }

      const app = render(<Harness />)

      const pending = controls.startEntry('test question')
      controls.handleRunComplete(makeRunResult(pending!.entryId, { cancelled: true }))

      await new Promise((resolve) => setTimeout(resolve, 50))

      app.unmount()

      const saved = await loadSession(projectPath)
      expect(saved).toBeNull()
    })
  })

  describe('de-duplication guard', () => {
    it('does not double-append when startEntry archives before handleRunComplete', async () => {
      let controls!: ReturnType<typeof useConversation>

      function Harness() {
        controls = useConversation({
          config: makeConfig('/tmp/dedup-test'),
          initialSession: null,
          taskState: 'processing',
        })
        return null
      }

      const app = render(<Harness />)

      const first = controls.startEntry('first question')
      await flush()

      // Start second entry — this archives the first via the safety net
      controls.startEntry('second question')
      await flush()

      expect(controls.completedTurns).toHaveLength(1)
      expect(controls.completedTurns[0]?.question).toBe('first question')

      // handleRunComplete fires for the first entry's run — should be a no-op
      // because activeEntryIdRef now points to the second entry
      controls.handleRunComplete(makeRunResult(first!.entryId))
      await flush()

      expect(controls.completedTurns).toHaveLength(1)
      expect(controls.liveTurn?.question).toBe('second question')

      app.unmount()
    })

    it('does not double-append when handleRunComplete fires before startEntry', async () => {
      let controls!: ReturnType<typeof useConversation>

      function Harness() {
        controls = useConversation({
          config: makeConfig('/tmp/dedup-test-2'),
          initialSession: null,
          taskState: 'processing',
        })
        return null
      }

      const app = render(<Harness />)

      const first = controls.startEntry('first question')
      await flush()

      controls.handleRunComplete(makeRunResult(first!.entryId))
      await flush()

      expect(controls.completedTurns).toHaveLength(1)
      expect(controls.liveTurn).toBeNull()

      controls.startEntry('second question')
      await flush()

      expect(controls.completedTurns).toHaveLength(1)
      expect(controls.liveTurn?.question).toBe('second question')

      app.unmount()
    })
  })

  describe('frame handling', () => {
    it('updates live turn answer on text delta', async () => {
      let controls!: ReturnType<typeof useConversation>

      function Harness() {
        controls = useConversation({
          config: makeConfig('/tmp/frame-test'),
          initialSession: null,
          taskState: 'processing',
        })
        return null
      }

      const app = render(<Harness />)

      controls.startEntry('test')
      controls.handleFrame(frame({ kind: 'agent-text-delta', accumulatedText: 'Hello world' }))
      await flush()

      expect(controls.liveTurn?.answer).toBe('Hello world')

      app.unmount()
    })

    it('appends tool calls to live turn', async () => {
      let controls!: ReturnType<typeof useConversation>

      function Harness() {
        controls = useConversation({
          config: makeConfig('/tmp/frame-tool-test'),
          initialSession: null,
          taskState: 'processing',
        })
        return null
      }

      const app = render(<Harness />)

      controls.startEntry('test')
      controls.handleFrame(
        frame({
          kind: 'tool-call-start',
          toolCall: {
            id: 'tc-1',
            index: 0,
            name: 'Read',
            input: { file_path: '/foo.ts' },
            status: 'running',
          },
        }),
      )
      await flush()

      expect(controls.liveTurn?.toolCalls).toHaveLength(1)
      expect(controls.liveTurn?.toolCalls[0]?.name).toBe('Read')

      app.unmount()
    })

    it('ignores frames when no live turn', async () => {
      let controls!: ReturnType<typeof useConversation>

      function Harness() {
        controls = useConversation({
          config: makeConfig('/tmp/frame-ignore-test'),
          initialSession: null,
          taskState: 'idle',
        })
        return null
      }

      const app = render(<Harness />)

      controls.handleFrame(frame({ kind: 'agent-text-delta', accumulatedText: 'orphan' }))
      await flush()

      expect(controls.liveTurn).toBeNull()

      app.unmount()
    })
  })

  describe('local submit errors', () => {
    it('records a local error as a completed turn', async () => {
      let controls!: ReturnType<typeof useConversation>

      function Harness() {
        controls = useConversation({
          config: makeConfig('/tmp/local-error-test'),
          initialSession: null,
          taskState: 'idle',
        })
        return null
      }

      const app = render(<Harness />)

      controls.recordLocalError('/explain', 'Slash command "/explain" not found.')
      await flush()

      expect(controls.liveTurn).toBeNull()
      expect(controls.completedTurns).toHaveLength(1)
      expect(controls.completedTurns[0]).toMatchObject({
        question: '/explain',
        answer: '',
        error: 'Slash command "/explain" not found.',
      })

      app.unmount()
    })

    it('records a local built-in answer as a completed turn', async () => {
      let controls!: ReturnType<typeof useConversation>

      function Harness() {
        controls = useConversation({
          config: makeConfig('/tmp/local-answer-test'),
          initialSession: null,
          taskState: 'idle',
        })
        return null
      }

      const app = render(<Harness />)

      controls.recordLocalAnswer('/commands', 'Available slash commands')
      await flush()

      expect(controls.liveTurn).toBeNull()
      expect(controls.completedTurns).toHaveLength(1)
      expect(controls.completedTurns[0]).toMatchObject({
        question: '/commands',
        answer: 'Available slash commands',
        error: null,
      })

      app.unmount()
    })
  })
})
