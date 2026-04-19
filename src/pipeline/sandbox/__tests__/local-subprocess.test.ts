import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { createSandbox } from '../factory'
import { PathEscapeError, SandboxAbortError, SandboxIoError, type Sandbox } from '../interface'
import { LocalSubprocessSandbox } from '../local-subprocess'

// ---- shared fixture --------------------------------------------------------
let tmpRoot: string
let sandbox: Sandbox

beforeAll(() => {
  // Per-suite tempdir so parallel runs / re-runs don't collide.
  // Realpath it so tests comparing to sandbox.rootDir don't fight macOS /var symlink.
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orb-sandbox-')))
  sandbox = createSandbox({ rootDir: tmpRoot })
})

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
})

// ---- 1. exec basic ---------------------------------------------------------
describe('exec — basic', () => {
  it('resolves with stdout containing the echoed string and exitCode 0', async () => {
    const result = await sandbox.exec('echo', ['hi'])
    expect(result.stdout).toContain('hi')
    expect(result.exitCode).toBe(0)
  })

  it('non-zero exit resolves (does not throw) with exitCode and stderr captured', async () => {
    const result = await sandbox.exec('bash', ['-c', 'echo to-stderr 1>&2; exit 2'])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('to-stderr')
  })

  it('awaits proc.exited so exitCode reflects the actual final exit (e.g. 7)', async () => {
    const result = await sandbox.exec('bash', ['-c', 'echo hello; exit 7'])
    expect(result.exitCode).toBe(7)
    expect(result.stdout).toContain('hello')
  })

  it('captures >64KB on both stdout and stderr without deadlocking (parallel drain)', async () => {
    const result = await sandbox.exec('bash', [
      '-c',
      'head -c 100000 /dev/urandom | base64; head -c 100000 /dev/urandom | base64 1>&2',
    ])
    expect(result.stdout.length).toBeGreaterThan(64 * 1024)
    expect(result.stderr.length).toBeGreaterThan(64 * 1024)
    expect(result.exitCode).toBe(0)
  })
})

// ---- 2. abort semantics ----------------------------------------------------
describe('exec — abort', () => {
  it('rejects with SandboxAbortError BEFORE spawning when signal is already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const spawnSpy = spyOn(Bun, 'spawn')
    try {
      await expect(sandbox.exec('echo', ['hi'], { signal: ctrl.signal })).rejects.toBeInstanceOf(
        SandboxAbortError,
      )
      expect(spawnSpy).not.toHaveBeenCalled()
    } finally {
      spawnSpy.mockRestore()
    }
  })

  it('kills a long-running command on mid-flight abort and rejects within ~500ms', async () => {
    const ctrl = new AbortController()
    const start = Date.now()
    const promise = sandbox.exec('sleep', ['5'], { signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 50)
    await expect(promise).rejects.toBeInstanceOf(SandboxAbortError)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1500)
  })

  it('does not hang when a high-throughput process is aborted mid-stream', async () => {
    // Process writes ~continuously to stdout AND stderr, then sleeps past any
    // reasonable test window. We abort while output is actively flowing —
    // the parallel drain must unblock (pipes close when the child dies) and
    // the exec promise must reject promptly with SandboxAbortError.
    const ctrl = new AbortController()
    const start = Date.now()
    const promise = sandbox.exec(
      'bash',
      [
        '-c',
        'while :; do head -c 8192 /dev/urandom | base64; head -c 8192 /dev/urandom | base64 1>&2; done; sleep 30',
      ],
      { signal: ctrl.signal },
    )
    setTimeout(() => ctrl.abort(), 100)
    await expect(promise).rejects.toBeInstanceOf(SandboxAbortError)
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('rejects before spawning if the signal aborts while resolving opts.cwd', async () => {
    const local = new LocalSubprocessSandbox({ rootDir: tmpRoot })
    const ctrl = new AbortController()
    const methods = local as unknown as {
      resolveInside: (rel: string, opts?: { forWrite?: boolean }) => Promise<string>
    }
    const originalResolveInside = methods.resolveInside.bind(local)
    methods.resolveInside = async (rel, opts) => {
      await new Promise((resolve) => setTimeout(resolve, 25))
      return originalResolveInside(rel, opts)
    }
    const spawnSpy = spyOn(Bun, 'spawn')

    try {
      const promise = local.exec('pwd', [], { cwd: '.', signal: ctrl.signal })
      setTimeout(() => ctrl.abort(), 5)
      await expect(promise).rejects.toBeInstanceOf(SandboxAbortError)
      expect(spawnSpy).not.toHaveBeenCalled()
    } finally {
      methods.resolveInside = originalResolveInside
      spawnSpy.mockRestore()
    }
  })

  it('actually kills the child — marker file is never written after abort', async () => {
    const markerName = `orb-marker-${crypto.randomUUID()}.txt`
    const markerPath = path.join(tmpRoot, markerName)
    const ctrl = new AbortController()

    const promise = sandbox.exec('bash', ['-c', `sleep 2; touch ${JSON.stringify(markerPath)}`], {
      signal: ctrl.signal,
    })
    // Abort immediately so the touch never runs.
    setTimeout(() => ctrl.abort(), 25)
    await expect(promise).rejects.toBeInstanceOf(SandboxAbortError)

    // Wait past the 2s sleep window to be sure no late touch slipped through.
    await new Promise((r) => setTimeout(r, 2500))
    expect(fs.existsSync(markerPath)).toBe(false)
  })
})

// ---- 3. cwd clamp ----------------------------------------------------------
describe('exec — cwd clamp', () => {
  it('allows opts.cwd === rootDir (equality case of the clamp)', async () => {
    const result = await sandbox.exec('pwd', [], { cwd: tmpRoot })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe(tmpRoot)
  })

  it('throws PathEscapeError when opts.cwd points outside rootDir', async () => {
    await expect(sandbox.exec('pwd', [], { cwd: '/tmp' })).rejects.toBeInstanceOf(PathEscapeError)
  })
})

// ---- 4. file IO + path clamp ----------------------------------------------
describe('readFile / writeFile', () => {
  it('round-trips content through writeFile + readFile inside rootDir', async () => {
    const rel = `roundtrip-${crypto.randomUUID()}.txt`
    const payload = 'hello sandbox\n'
    await sandbox.writeFile(rel, payload)
    const got = await sandbox.readFile(rel)
    expect(got).toBe(payload)
  })

  it('readFile allows paths outside rootDir — only writes are clamped', async () => {
    const outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orb-outside-')))
    const outsideFile = path.join(outsideDir, 'note.txt')
    fs.writeFileSync(outsideFile, 'hi from outside\n')
    try {
      expect(await sandbox.readFile(outsideFile)).toBe('hi from outside\n')
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('writeFile to a path outside rootDir throws PathEscapeError and does not create the file', async () => {
    const escapeName = `orb-escape-${crypto.randomUUID()}.txt`
    const escapeAbs = path.join(os.tmpdir(), escapeName)
    const escapeRel = path.relative(tmpRoot, escapeAbs)
    await expect(sandbox.writeFile(escapeRel, 'should not exist')).rejects.toBeInstanceOf(
      PathEscapeError,
    )
    expect(fs.existsSync(escapeAbs)).toBe(false)
  })

  it('readFile on a nonexistent-but-inside-rootDir path throws SandboxIoError (not PathEscapeError)', async () => {
    const rel = `missing-${crypto.randomUUID()}.txt`
    await expect(sandbox.readFile(rel)).rejects.toBeInstanceOf(SandboxIoError)
  })

  it('readFile honors an already-aborted signal', async () => {
    const rel = `abort-read-${crypto.randomUUID()}.txt`
    fs.writeFileSync(path.join(tmpRoot, rel), 'hello\n')
    const ctrl = new AbortController()
    ctrl.abort()

    await expect(sandbox.readFile(rel, { signal: ctrl.signal })).rejects.toBeInstanceOf(
      SandboxAbortError,
    )
  })

  it('writeFile honors an already-aborted signal and does not create the file', async () => {
    const rel = `abort-write-${crypto.randomUUID()}.txt`
    const ctrl = new AbortController()
    ctrl.abort()

    await expect(sandbox.writeFile(rel, 'hello\n', { signal: ctrl.signal })).rejects.toBeInstanceOf(
      SandboxAbortError,
    )
    expect(fs.existsSync(path.join(tmpRoot, rel))).toBe(false)
  })

  it('rejects symlink-escape on writes (reads through the symlink are allowed)', async () => {
    const escapeTarget = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orb-escape-')))
    const targetFile = path.join(escapeTarget, 'secret.txt')
    fs.writeFileSync(targetFile, 'secret\n')

    const linkName = `escape-link-${crypto.randomUUID()}`
    const linkPath = path.join(tmpRoot, linkName)
    fs.symlinkSync(escapeTarget, linkPath)

    try {
      expect(await sandbox.readFile(`${linkName}/secret.txt`)).toBe('secret\n')
      await expect(sandbox.writeFile(`${linkName}/created.txt`, 'nope')).rejects.toBeInstanceOf(
        PathEscapeError,
      )
      await expect(sandbox.writeFile(`${linkName}/secret.txt`, 'overwrite')).rejects.toBeInstanceOf(
        PathEscapeError,
      )
    } finally {
      fs.rmSync(linkPath, { force: true })
      fs.rmSync(escapeTarget, { recursive: true, force: true })
    }
  })
})

// ---- 5. abort listener cleanup --------------------------------------------
describe('exec — abort listener cleanup', () => {
  // Wrap a real AbortController so we can count add / remove on the underlying signal.
  function makeCountingController(): {
    controller: AbortController
    counts: { added: number; removed: number }
  } {
    const controller = new AbortController()
    const counts = { added: 0, removed: 0 }
    const signal = controller.signal
    const origAdd = signal.addEventListener.bind(signal)
    const origRemove = signal.removeEventListener.bind(signal)
    signal.addEventListener = ((type: string, listener: unknown, options?: unknown) => {
      if (type === 'abort') counts.added++
      return (origAdd as (...a: unknown[]) => void)(type, listener, options)
    }) as typeof signal.addEventListener
    signal.removeEventListener = ((type: string, listener: unknown, options?: unknown) => {
      if (type === 'abort') counts.removed++
      return (origRemove as (...a: unknown[]) => void)(type, listener, options)
    }) as typeof signal.removeEventListener
    return { controller, counts }
  }

  it('removes the abort listener after exec resolves (success path)', async () => {
    const { controller, counts } = makeCountingController()
    const result = await sandbox.exec('echo', ['ok'], { signal: controller.signal })
    expect(result.exitCode).toBe(0)
    expect(counts.added).toBeGreaterThan(0)
    expect(counts.added).toBe(counts.removed)
  })

  it('removes the abort listener after exec rejects (mid-flight abort path)', async () => {
    const { controller, counts } = makeCountingController()
    const promise = sandbox.exec('sleep', ['5'], { signal: controller.signal })
    setTimeout(() => controller.abort(), 25)
    await expect(promise).rejects.toBeInstanceOf(SandboxAbortError)
    expect(counts.added).toBeGreaterThan(0)
    expect(counts.added).toBe(counts.removed)
  })

  it('does not accumulate listeners across many exec calls', async () => {
    const { controller, counts } = makeCountingController()
    for (let i = 0; i < 5; i++) {
      await sandbox.exec('echo', [`iter-${i}`], { signal: controller.signal })
    }
    expect(counts.added).toBe(5)
    expect(counts.removed).toBe(5)
  })
})

// ---- 6. dispose ------------------------------------------------------------
describe('dispose', () => {
  it('resolves and is idempotent (callable twice)', async () => {
    const local = createSandbox({ rootDir: tmpRoot })
    await expect(local.dispose()).resolves.toBeUndefined()
    await expect(local.dispose()).resolves.toBeUndefined()
  })

  it('[Symbol.asyncDispose] also resolves', async () => {
    const local = createSandbox({ rootDir: tmpRoot })
    await expect(local[Symbol.asyncDispose]()).resolves.toBeUndefined()
  })
})

// ---- 7. factory ------------------------------------------------------------
describe('factory', () => {
  it('createSandbox returns a Sandbox-shaped LocalSubprocessSandbox', () => {
    const sb = createSandbox({ rootDir: tmpRoot })
    expect(sb).toBeInstanceOf(LocalSubprocessSandbox)
    expect(typeof sb.exec).toBe('function')
    expect(typeof sb.readFile).toBe('function')
    expect(typeof sb.writeFile).toBe('function')
    expect(typeof sb.dispose).toBe('function')
    expect(typeof sb[Symbol.asyncDispose]).toBe('function')
    expect(sb.rootDir).toBe(tmpRoot)
  })
})
