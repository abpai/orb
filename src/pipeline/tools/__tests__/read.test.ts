import { describe, expect, it } from 'bun:test'
import { readFile } from '../read.ts'
import { isToolError } from '../../adapters/utils.ts'
import {
  PathEscapeError,
  type ExecOpts,
  type ExecResult,
  type ReadOpts,
  type Sandbox,
  type WriteOpts,
} from '../../sandbox/interface.ts'

class FakeSandbox implements Sandbox {
  readonly rootDir = '/tmp/fake'
  lastSignal?: AbortSignal
  lastReadPath?: string
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
    this.lastReadPath = p
    return this.readFileImpl(p)
  }
  async writeFile(p: string, content: string, opts?: WriteOpts): Promise<void> {
    this.lastSignal = opts?.signal
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
  if (typeof readFile.execute !== 'function') {
    throw new Error('readFile.execute is not defined')
  }
  return Promise.resolve(
    readFile.execute(input as never, {
      toolCallId: 't',
      messages: [],
      experimental_context: { sandbox, signal },
    }),
  )
}

describe('readFile tool', () => {
  it('returns { content } when sandbox resolves', async () => {
    const sandbox = new FakeSandbox()
    sandbox.readFileImpl = async () => 'hello world'
    const controller = new AbortController()

    const result = (await callExecute(
      { path: 'README.md' },
      sandbox,
      controller.signal,
    )) as { content: string }

    expect(result).toEqual({ content: 'hello world' })
    expect(sandbox.lastReadPath).toBe('README.md')
    expect(sandbox.lastSignal).toBe(controller.signal)
    expect(isToolError(result)).toBe(false)
  })

  it('returns { error, isError: true } when sandbox throws PathEscapeError', async () => {
    const sandbox = new FakeSandbox()
    sandbox.readFileImpl = async () => {
      throw new PathEscapeError('refused to read ../etc/passwd')
    }
    const controller = new AbortController()

    const result = (await callExecute(
      { path: '../etc/passwd' },
      sandbox,
      controller.signal,
    )) as { error: string; isError: true }

    expect(result.isError).toBe(true)
    expect(result.error).toBe('refused to read ../etc/passwd')
    expect(isToolError(result)).toBe(true)
  })

  it('wraps generic errors into the same shape', async () => {
    const sandbox = new FakeSandbox()
    sandbox.readFileImpl = async () => {
      throw new Error('ENOENT')
    }
    const controller = new AbortController()

    const result = (await callExecute(
      { path: 'missing.txt' },
      sandbox,
      controller.signal,
    )) as { error: string; isError: true }

    expect(result.isError).toBe(true)
    expect(result.error).toBe('ENOENT')
  })
})
