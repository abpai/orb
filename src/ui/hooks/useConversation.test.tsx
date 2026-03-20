import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { render } from 'ink-testing-library'

import { ANTHROPIC_MODELS, DEFAULT_CONFIG } from '../../types'
import { getSessionPath, loadSession } from '../../services/session'
import { useConversation } from './useConversation'

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
        config: { ...DEFAULT_CONFIG, projectPath },
        initialSession: null,
        taskState: 'idle',
      })

      return null
    }

    const app = render(<Harness />)

    controls.cycleModel()
    await new Promise((resolve) => setTimeout(resolve, 20))

    app.unmount()

    const saved = await loadSession(projectPath)
    expect(saved).not.toBeNull()
    expect(saved?.llmModel).toBe(ANTHROPIC_MODELS[1])
    expect(saved?.history).toEqual([])
  })
})
