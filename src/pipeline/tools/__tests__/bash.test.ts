import { describe, expect, it } from 'bun:test'
import { bash } from '../bash.ts'
import { isToolError } from '../../adapters/utils.ts'
import type {
  ExecOpts,
  ExecResult,
  ReadOpts,
  Sandbox,
  WriteOpts,
} from '../../sandbox/interface.ts'

class FakeSandbox implements Sandbox {
  readonly rootDir = '/tmp/fake'
  lastSignal?: AbortSignal
  lastCmd?: string
  lastArgs?: string[]
  lastOpts?: ExecOpts
  execImpl: (cmd: string, args: string[], opts?: ExecOpts) => Promise<ExecResult> = async () => ({
    stdout: '',
    stderr: '',
    exitCode: 0,
  })
  readFileImpl: (p: string) => Promise<string> = async () => ''
  writeFileImpl: (p: string, c: string) => Promise<void> = async () => {}

  async exec(cmd: string, args: string[], opts?: ExecOpts): Promise<ExecResult> {
    this.lastSignal = opts?.signal
    this.lastCmd = cmd
    this.lastArgs = args
    this.lastOpts = opts
    return this.execImpl(cmd, args, opts)
  }
  async readFile(p: string, opts?: ReadOpts): Promise<string> {
    this.lastSignal = opts?.signal
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
  if (typeof bash.execute !== 'function') {
    throw new Error('bash.execute is not defined')
  }
  return Promise.resolve(
    bash.execute(input as never, {
      toolCallId: 't',
      messages: [],
      experimental_context: { sandbox, signal },
    }),
  )
}

describe('bash tool', () => {
  describe('input schema', () => {
    it('accepts a valid command', () => {
      const schema = bash.inputSchema as unknown as {
        safeParse: (v: unknown) => { success: boolean }
      }
      expect(schema.safeParse({ command: 'ls' }).success).toBe(true)
    })

    it('rejects a non-string command', () => {
      const schema = bash.inputSchema as unknown as {
        safeParse: (v: unknown) => { success: boolean }
      }
      expect(schema.safeParse({ command: 123 }).success).toBe(false)
    })
  })

  describe('execute', () => {
    it('forwards command/timeoutMs/cwd and returns the exec result unchanged', async () => {
      const sandbox = new FakeSandbox()
      sandbox.execImpl = async () => ({
        stdout: 'hello',
        stderr: 'warn',
        exitCode: 0,
      })
      const controller = new AbortController()

      const result = (await callExecute(
        { command: 'echo hi', timeoutMs: 5_000, cwd: 'sub' },
        sandbox,
        controller.signal,
      )) as ExecResult

      expect(result).toEqual({ stdout: 'hello', stderr: 'warn', exitCode: 0 })
      expect(sandbox.lastCmd).toBe('bash')
      expect(sandbox.lastArgs).toEqual(['-lc', 'echo hi'])
      expect(sandbox.lastOpts?.cwd).toBe('sub')
      expect(isToolError(result)).toBe(false)
    })

    it('makes utils.isToolError return true for non-zero exit codes', async () => {
      const sandbox = new FakeSandbox()
      sandbox.execImpl = async () => ({
        stdout: '',
        stderr: 'boom',
        exitCode: 2,
      })
      const controller = new AbortController()

      const result = (await callExecute(
        { command: 'false' },
        sandbox,
        controller.signal,
      )) as ExecResult

      expect(result.exitCode).toBe(2)
      expect(isToolError(result)).toBe(true)
    })

    it('aborts the captured signal once timeoutMs elapses', async () => {
      const sandbox = new FakeSandbox()
      sandbox.execImpl = (_cmd, _args, opts) =>
        new Promise<ExecResult>((resolve, reject) => {
          opts?.signal?.addEventListener(
            'abort',
            () => reject(new Error('aborted')),
            { once: true },
          )
          // Long-running fake — only resolves if the signal does not fire.
          setTimeout(
            () => resolve({ stdout: 'late', stderr: '', exitCode: 0 }),
            5_000,
          )
        })

      const controller = new AbortController()
      const start = Date.now()

      await expect(
        callExecute({ command: 'sleep 5', timeoutMs: 50 }, sandbox, controller.signal),
      ).rejects.toThrow('aborted')

      const elapsed = Date.now() - start
      expect(sandbox.lastSignal?.aborted).toBe(true)
      expect(elapsed).toBeLessThan(500)
    })

    it('passes the adapter signal through unchanged when no timeoutMs', async () => {
      const sandbox = new FakeSandbox()
      sandbox.execImpl = async (_cmd, _args, opts) => {
        // Wait a tick so the test can abort before we resolve.
        await new Promise((r) => setTimeout(r, 5))
        return {
          stdout: opts?.signal?.aborted ? 'aborted' : 'ok',
          stderr: '',
          exitCode: 0,
        }
      }

      const controller = new AbortController()
      const promise = callExecute({ command: 'ls' }, sandbox, controller.signal)
      controller.abort()
      await promise

      expect(sandbox.lastSignal).toBeDefined()
      expect(sandbox.lastSignal?.aborted).toBe(true)
    })

    it('combines adapter signal + timeout via AbortSignal.any (adapter abort wins)', async () => {
      const sandbox = new FakeSandbox()
      sandbox.execImpl = async (_cmd, _args, opts) => {
        await new Promise((r) => setTimeout(r, 5))
        return {
          stdout: opts?.signal?.aborted ? 'aborted' : 'ok',
          stderr: '',
          exitCode: 0,
        }
      }

      const controller = new AbortController()
      const promise = callExecute(
        { command: 'sleep 60', timeoutMs: 60_000 },
        sandbox,
        controller.signal,
      )
      controller.abort()
      await promise

      expect(sandbox.lastSignal).toBeDefined()
      // The combined signal must inherit the adapter abort, even though the
      // 60s timeout has not fired.
      expect(sandbox.lastSignal?.aborted).toBe(true)
    })

    it('throws when experimental_context is missing', async () => {
      if (typeof bash.execute !== 'function') {
        throw new Error('bash.execute is not defined')
      }
      await expect(
        Promise.resolve(
          bash.execute({ command: 'ls' } as never, {
            toolCallId: 't',
            messages: [],
          }),
        ),
      ).rejects.toThrow(/experimental_context/)
    })
  })
})
