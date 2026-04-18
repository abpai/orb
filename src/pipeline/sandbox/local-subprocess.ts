import * as fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'

import {
  PathEscapeError,
  SandboxAbortError,
  SandboxIoError,
  type ExecOpts,
  type ExecResult,
  type ReadOpts,
  type Sandbox,
  type WriteOpts,
} from './interface'

export class LocalSubprocessSandbox implements Sandbox {
  readonly rootDir: string

  constructor(opts: { rootDir: string }) {
    this.rootDir = fs.realpathSync(path.resolve(opts.rootDir))
  }

  private async resolveInside(rel: string, opts?: { forWrite?: boolean }): Promise<string> {
    const candidate = path.resolve(this.rootDir, rel)
    let resolved: string
    let realpathFailed: NodeJS.ErrnoException | null = null
    try {
      resolved = await fsp.realpath(candidate)
    } catch (err) {
      realpathFailed = err as NodeJS.ErrnoException
      // Fall back: walk up to the deepest existing ancestor, realpath it, then
      // re-join the remaining (non-existent) suffix. This lets us still apply
      // the clamp on paths whose leaf (or several segments) don't exist yet —
      // both for legitimate writeFile new-file creation AND for catching escape
      // attempts that point at non-existent paths outside the root.
      let cur = path.dirname(candidate)
      const tail: string[] = [path.basename(candidate)]
      // Stop if we hit the filesystem root (cur stops shrinking).
      while (true) {
        try {
          const realCur = await fsp.realpath(cur)
          resolved = path.join(realCur, ...tail)
          break
        } catch (innerErr) {
          if ((innerErr as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new SandboxIoError(`realpath failed for ${rel}: ${(innerErr as Error).message}`)
          }
          const parent = path.dirname(cur)
          if (parent === cur) {
            // Reached filesystem root without finding an existing ancestor.
            throw new SandboxIoError(`realpath failed for ${rel}: ${realpathFailed.message}`)
          }
          tail.unshift(path.basename(cur))
          cur = parent
        }
      }
    }
    const ok = resolved === this.rootDir || resolved.startsWith(this.rootDir + path.sep)
    if (!ok) {
      throw new PathEscapeError(`path ${rel} escapes rootDir`)
    }
    // If realpath failed for the original candidate and we're not in write mode,
    // the path is inside the root but the file doesn't exist — surface as IO error.
    if (realpathFailed && !opts?.forWrite) {
      throw new SandboxIoError(`realpath failed for ${rel}: ${realpathFailed.message}`)
    }
    return resolved
  }

  private throwIfAborted(signal: AbortSignal | undefined, message: string): void {
    if (signal?.aborted) {
      throw new SandboxAbortError(message)
    }
  }

  private isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError'
  }

  async exec(cmd: string, args: string[], opts?: ExecOpts): Promise<ExecResult> {
    const signal = opts?.signal

    // (1) pre-spawn abort guard — must throw BEFORE spawning.
    this.throwIfAborted(signal, 'aborted before spawn')

    // (2) resolve cwd through the clamp; default to rootDir.
    const resolvedCwd = opts?.cwd ? await this.resolveInside(opts.cwd) : this.rootDir
    this.throwIfAborted(signal, 'aborted before spawn')

    // (3) spawn.
    const proc = Bun.spawn({
      cmd: [cmd, ...args],
      cwd: resolvedCwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    // (4) abort listener — kill child on abort. Track aborted state for post-drain decision.
    let aborted = false
    const onAbort = () => {
      aborted = true
      try {
        proc.kill()
      } catch {
        // ignore — process may already be dead
      }
    }
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      // (5) parallel drain + exit collection — serial reads deadlock on full pipe buffers.
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      if (aborted) {
        throw new SandboxAbortError('aborted during exec')
      }

      return { stdout, stderr, exitCode }
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }
  }

  async readFile(relPath: string, opts?: ReadOpts): Promise<string> {
    this.throwIfAborted(opts?.signal, 'aborted before readFile')
    const resolved = await this.resolveInside(relPath)
    try {
      return await fsp.readFile(resolved, { encoding: 'utf8', signal: opts?.signal })
    } catch (err) {
      if (this.isAbortError(err)) {
        throw new SandboxAbortError('aborted during readFile')
      }
      throw new SandboxIoError(`readFile failed for ${relPath}: ${(err as Error).message}`)
    }
  }

  async writeFile(relPath: string, content: string, opts?: WriteOpts): Promise<void> {
    this.throwIfAborted(opts?.signal, 'aborted before writeFile')
    const resolved = await this.resolveInside(relPath, { forWrite: true })
    try {
      await fsp.writeFile(resolved, content, { encoding: 'utf8', signal: opts?.signal })
    } catch (err) {
      if (this.isAbortError(err)) {
        throw new SandboxAbortError('aborted during writeFile')
      }
      throw new SandboxIoError(`writeFile failed for ${relPath}: ${(err as Error).message}`)
    }
  }

  dispose(): Promise<void> {
    // Each exec owns its own process lifetime — nothing to release here.
    return Promise.resolve()
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose()
  }
}
