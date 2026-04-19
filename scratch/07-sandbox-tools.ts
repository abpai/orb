/**
 * scratch/07-sandbox-tools.ts — Sandbox + Owned Tools
 *
 * Shows the OpenAI adapter's execution boundary:
 *   Sandbox interface + three owned tools wired via experimental_context.
 *
 * This is the seam that replaced the external `bash-tool` dependency. Tools
 * depend only on the `Sandbox` contract, so swapping LocalSubprocessSandbox
 * for a remote or virtualized backend is a factory-level change.
 *
 * ENTRY: src/pipeline/sandbox/interface.ts      Sandbox contract
 *        src/pipeline/sandbox/factory.ts:4      createSandbox()
 *        src/pipeline/tools/{bash,read,write}.ts owned ai-sdk tools
 *        src/pipeline/adapters/openai.ts:35-37  wiring via experimental_context
 *
 * Run:
 *   bun run scratch/07-sandbox-tools.ts
 */
import { mkdir, mkdtemp, rm, symlink, writeFile as fsWriteFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSandbox } from '../src/pipeline/sandbox/factory'
import { PathEscapeError } from '../src/pipeline/sandbox/interface'
import { bash, readFile, writeFile } from '../src/pipeline/tools'
import type { ToolCtx } from '../src/pipeline/tools/context'

type ToolDef = {
  execute: (
    input: Record<string, unknown>,
    options: { experimental_context: ToolCtx },
  ) => Promise<unknown>
}

async function invoke(
  toolDef: unknown,
  input: Record<string, unknown>,
  experimental_context: ToolCtx,
): Promise<unknown> {
  return await (toolDef as ToolDef).execute(input, { experimental_context })
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'orb-scratch-sandbox-'))
  const projectPath = path.join(root, 'project')
  await mkdir(projectPath, { recursive: true })
  await fsWriteFile(path.join(projectPath, 'README.md'), '# project readme\n', 'utf8')
  return projectPath
}

console.log('07 · Sandbox + Owned Tools\n')
console.log('Primitive:')
console.log('  Sandbox interface + owned tools -> provider-agnostic execution boundary\n')

const projectPath = await createProject()
const outsidePath = path.dirname(projectPath)

try {
  console.log('─── Sandbox contract ───\n')
  console.log(`  rootDir    : ${projectPath}`)
  console.log('  exec(cmd, args, opts)     : run subprocess, returns {stdout, stderr, exitCode}')
  console.log('  readFile(path, opts)      : UTF-8 read, absolute OR project-relative')
  console.log('  writeFile(path, ...)      : UTF-8 write, clamped to rootDir (symlink-safe)')
  console.log('  dispose()                 : release sandbox resources\n')

  const sandbox = createSandbox({ rootDir: projectPath })
  const ctx: ToolCtx = { sandbox, signal: new AbortController().signal }

  try {
    console.log('─── bash tool ───\n')
    const lsResult = (await invoke(
      bash,
      { command: 'ls README.md' },
      ctx,
    )) as { stdout: string; exitCode: number }
    console.log(`  bash("ls README.md") → exitCode=${lsResult.exitCode} stdout=${JSON.stringify(lsResult.stdout.trim())}`)

    const cwdResult = (await invoke(
      bash,
      { command: 'pwd', cwd: '.' },
      ctx,
    )) as { stdout: string }
    console.log(`  bash("pwd", cwd=".") → ${JSON.stringify(cwdResult.stdout.trim())}`)

    console.log('\n─── readFile tool ───\n')
    const relRead = (await invoke(readFile, { path: 'README.md' }, ctx)) as { content: string }
    console.log(`  readFile("README.md")  → ${JSON.stringify(relRead.content)}`)
    const absRead = (await invoke(
      readFile,
      { path: path.join(projectPath, 'README.md') },
      ctx,
    )) as { content: string }
    console.log(`  readFile(absolute)     → ${JSON.stringify(absRead.content)}`)
    const missing = (await invoke(readFile, { path: 'nope.txt' }, ctx)) as {
      error?: string
      isError?: boolean
    }
    console.log(`  readFile("nope.txt")   → error=${missing.isError} message=${JSON.stringify(missing.error)}`)

    console.log('\n─── writeFile tool (root-clamped) ───\n')
    const okWrite = (await invoke(
      writeFile,
      { path: 'notes.txt', content: 'hello from sandbox\n' },
      ctx,
    )) as { success?: boolean }
    console.log(`  writeFile("notes.txt") → success=${okWrite.success}`)
    const verify = (await invoke(readFile, { path: 'notes.txt' }, ctx)) as { content: string }
    console.log(`  readFile("notes.txt")  → ${JSON.stringify(verify.content)}`)

    const escape = (await invoke(
      writeFile,
      { path: '../escape.txt', content: 'nope' },
      ctx,
    )) as { error?: string; isError?: boolean }
    console.log(`  writeFile("../escape") → error=${escape.isError} message=${JSON.stringify(escape.error)}`)

    console.log('\n─── Symlink escape protection ───\n')
    await symlink(outsidePath, path.join(projectPath, 'outside-link'))
    const symlinkEscape = (await invoke(
      writeFile,
      { path: 'outside-link/leak.txt', content: 'nope' },
      ctx,
    )) as { error?: string; isError?: boolean }
    console.log(`  via symlink            → error=${symlinkEscape.isError} message=${JSON.stringify(symlinkEscape.error)}`)
    console.log(`  PathEscapeError code   → ${new PathEscapeError('x').code}`)

    console.log('\n─── Abort signal propagation ───\n')
    const controller = new AbortController()
    const slow = invoke(bash, { command: 'sleep 2' }, { sandbox, signal: controller.signal })
    setTimeout(() => controller.abort(), 20)
    try {
      const aborted = (await slow) as { exitCode?: number; stderr?: string }
      console.log(`  bash("sleep 2") + abort → exitCode=${aborted.exitCode}`)
    } catch (err) {
      console.log(`  bash("sleep 2") + abort → threw ${(err as Error).name}`)
    }
  } finally {
    await sandbox.dispose()
  }
} finally {
  await rm(path.dirname(projectPath), { recursive: true, force: true })
}

console.log('\nTakeaway:')
console.log('  The OpenAI adapter does not execute anything itself.')
console.log('  Tools call into a Sandbox; Sandbox owns process/filesystem safety.')
console.log('  Swap LocalSubprocessSandbox for a different backend without touching tools.')
