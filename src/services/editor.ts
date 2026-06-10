import { promises as fsp } from 'node:fs'
import * as path from 'node:path'

import { resolveWithDeepestAncestor } from './path-clamp'
import type { FileRef } from './file-refs'

const DEFAULT_MAX_FILES = 4
const DEFAULT_EDITOR = 'cursor'

/** Result of one launch attempt. `missing` flags an editor that isn't on PATH. */
interface LaunchResult {
  ok: boolean
  error?: string
  missing?: boolean
}

export type EditorLauncher = (command: string, args: string[]) => Promise<LaunchResult>

interface OpenInEditorOptions {
  projectPath: string
  /** Cap on how many files we'll open at once. Extra refs are reported, not opened. */
  maxFiles?: number
  /** Editor CLI to invoke. Defaults to `cursor`. */
  editorCommand?: string
  /** Injectable launch seam (tests). Defaults to a `Bun.spawn` of the editor CLI. */
  launch?: EditorLauncher
}

/** A ref that resolved to a real file inside the project. */
interface ResolvedRef extends FileRef {
  /** Absolute, realpath-resolved file path. */
  resolved: string
}

interface OpenOutcome {
  /** Files actually handed to the editor. */
  opened: ResolvedRef[]
  /** Refs that resolved outside the project root (refused). */
  outsideProject: FileRef[]
  /** Refs whose target doesn't exist on disk. */
  notFound: FileRef[]
  /** Refs dropped because they exceeded `maxFiles`. */
  heldBack: FileRef[]
  /** The editor CLI wasn't found on PATH. */
  editorMissing: boolean
  /** A launch error (other than missing editor), surfaced for the status line. */
  error?: string
}

/** Default launcher: spawn the editor CLI and wait for it to return. */
const defaultLaunch: EditorLauncher = async (command, args) => {
  try {
    const proc = Bun.spawn({
      cmd: [command, ...args],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = (await new Response(proc.stderr).text()).trim()
      return { ok: false, error: stderr || `${command} exited with code ${exitCode}` }
    }
    return { ok: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { ok: false, missing: true, error: `'${command}' was not found on your PATH` }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Build the editor argv for a single file: reuse the window, jump to the line. */
function gotoArgs(ref: ResolvedRef): string[] {
  const target = ref.line ? `${ref.resolved}:${ref.line}` : ref.resolved
  return ['--reuse-window', '--goto', target]
}

/**
 * Open file references in the user's editor (Cursor by default).
 *
 * Each ref is resolved against the project root through realpath so symlinks
 * can't escape; refs that land outside the project, or that don't exist, are
 * refused and reported rather than opened. Results are deduped by resolved path
 * and capped to `maxFiles`. Every open reuses the existing editor window and
 * jumps to the line, so a walkthrough re-points one window instead of piling up
 * tabs or spawning new windows.
 */
export async function openInEditor(
  refs: FileRef[],
  options: OpenInEditorOptions,
): Promise<OpenOutcome> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const editor = options.editorCommand ?? DEFAULT_EDITOR
  const launch = options.launch ?? defaultLaunch

  const outcome: OpenOutcome = {
    opened: [],
    outsideProject: [],
    notFound: [],
    heldBack: [],
    editorMissing: false,
  }

  if (refs.length === 0) return outcome

  let root: string
  try {
    root = await fsp.realpath(path.resolve(options.projectPath))
  } catch {
    root = path.resolve(options.projectPath)
  }

  // Resolve + classify every ref, deduping by resolved path.
  const resolved: ResolvedRef[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    let result: Awaited<ReturnType<typeof resolveWithDeepestAncestor>>
    try {
      result = await resolveWithDeepestAncestor(root, ref.path)
    } catch {
      outcome.notFound.push(ref)
      continue
    }

    const inside = result.resolved === root || result.resolved.startsWith(root + path.sep)
    if (!inside) {
      outcome.outsideProject.push(ref)
      continue
    }
    // Must exist and be a regular file — we open files, not directories.
    let isFile = false
    try {
      isFile = result.leafExists && (await fsp.stat(result.resolved)).isFile()
    } catch {
      isFile = false
    }
    if (!isFile) {
      outcome.notFound.push(ref)
      continue
    }
    if (seen.has(result.resolved)) continue
    seen.add(result.resolved)
    resolved.push({ ...ref, resolved: result.resolved })
  }

  const toOpen = resolved.slice(0, maxFiles)
  outcome.heldBack = resolved.slice(maxFiles)

  // Open the most relevant ref last so the window's focus lands on it.
  for (const ref of [...toOpen].reverse()) {
    const result = await launch(editor, gotoArgs(ref))
    if (result.ok) {
      outcome.opened.push(ref)
      continue
    }
    if (result.missing) {
      outcome.editorMissing = true
      break
    }
    outcome.error = result.error
  }

  // We opened in reverse for focus; report them in their original order.
  outcome.opened.reverse()
  return outcome
}

/** Render a short, spoken-friendly status line describing what happened. */
export function formatOpenOutcome(
  outcome: OpenOutcome,
  options: { editorName?: string } = {},
): string {
  const editorName = options.editorName ?? 'Cursor'

  if (outcome.editorMissing) {
    return `Couldn't open files — ${editorName} isn't on your PATH. In ${editorName}, run "Shell Command: Install 'cursor' command" and try again.`
  }

  const describe = (ref: FileRef) => (ref.line ? `${ref.path}:${ref.line}` : ref.path)

  if (outcome.opened.length > 0) {
    const names = outcome.opened.map(describe).join(', ')
    const parts = [`Opened ${names} in ${editorName}.`]
    if (outcome.heldBack.length > 0) {
      parts.push(`Held back ${outcome.heldBack.length} more.`)
    }
    return parts.join(' ')
  }

  if (outcome.error) return `Couldn't open files: ${outcome.error}`
  if (outcome.outsideProject.length > 0) {
    return `Refused to open ${outcome.outsideProject.length} file(s) outside the project.`
  }
  if (outcome.notFound.length > 0) {
    return `Couldn't find ${outcome.notFound.map(describe).join(', ')} on disk.`
  }
  return 'No files to open yet — ask about some code first, then try again.'
}
