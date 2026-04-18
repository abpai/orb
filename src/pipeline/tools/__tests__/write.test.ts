import { describe, expect, it } from 'bun:test'
import { writeFile } from '../write.ts'
import * as tools from '../index.ts'
import { isToolError } from '../../adapters/utils.ts'
import {
  SandboxIoError,
  type ExecOpts,
  type ExecResult,
  type ReadOpts,
  type Sandbox,
  type WriteOpts,
} from '../../sandbox/interface.ts'

class FakeSandbox implements Sandbox {
  readonly rootDir = '/tmp/fake'
  lastSignal?: AbortSignal
  lastWritePath?: string
  lastWriteContent?: string
  execImpl: (cmd: string, args: string[], opts?: ExecOpts) => Promise<ExecResult> = async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  })
  readFileImpl: (p: string) => Promise<string> = async () => ''
  writeFileImpl: (p: string, c: string) => Promise<void> = async () => {}

  async exec(cmd: string, args: string[], opts?: ExecOpts): Promise<ExecResult> {
    this.lastSignal = opts?.signal
    return this.execImpl(cmd, args, opts)
  }
  async readFile(p: string, opts?: ReadOpts): Promise<string> {
    this.lastSignal = opts?.signal
    return this.readFileImpl(p)
  }
  async writeFile(p: string, content: string, opts?: WriteOpts): Promise<void> {
    this.lastSignal = opts?.signal
    this.lastWritePath = p
    this.lastWriteContent = content
    return this.writeFileImpl(p, content)
  }
  async dispose(): Promise<void> {}
  async [Symbol.asyncDispose](): Promise<void> {}
}

function callExecute(
  input: unknown,
  sandbox: Sandbox,
  signal: AbortSignal,
): Promise<unknown> {
  if (typeof writeFile.execute !== 'function') {
    throw new Error('writeFile.execute is not defined')
  }
  return Promise.resolve(
    writeFile.execute(input as never, {
      toolCallId: 't',
      messages: [],
      experimental_context: { sandbox, signal },
    }),
  )
}

describe('writeFile tool', () => {
  it('forwards { path, content } and returns { success: true }', async () => {
    const sandbox = new FakeSandbox()
    const controller = new AbortController()

    const result = (await callExecute(
      { path: 'notes.md', content: 'hello' },
      sandbox,
      controller.signal,
    )) as { success: true }

    expect(result).toEqual({ success: true })
    expect(sandbox.lastWritePath).toBe('notes.md')
    expect(sandbox.lastWriteContent).toBe('hello')
    expect(sandbox.lastSignal).toBe(controller.signal)
    expect(isToolError(result)).toBe(false)
  })

  it('returns { error, isError: true } when sandbox rejects', async () => {
    const sandbox = new FakeSandbox()
    sandbox.writeFileImpl = async () => {
      throw new SandboxIoError('disk full')
    }
    const controller = new AbortController()

    const result = (await callExecute(
      { path: 'big.bin', content: 'x' },
      sandbox,
      controller.signal,
    )) as { error: string; isError: true }

    expect(result.isError).toBe(true)
    expect(result.error).toBe('disk full')
    expect(isToolError(result)).toBe(true)
  })
})

describe('tools barrel', () => {
  it('re-exports exactly bash, readFile, writeFile', () => {
    expect(Object.keys(tools).sort()).toEqual(['bash', 'readFile', 'writeFile'])
  })

  it('every barrel export has a description and inputSchema', () => {
    for (const name of ['bash', 'readFile', 'writeFile'] as const) {
      const t = tools[name] as { description?: string; inputSchema?: unknown }
      expect(typeof t.description).toBe('string')
      expect(t.inputSchema).toBeDefined()
    }
  })
})
