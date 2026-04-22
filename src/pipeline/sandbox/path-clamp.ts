import { promises as fsp } from 'node:fs'
import * as path from 'node:path'

export interface ResolveResult {
  resolved: string
  /** False when the candidate leaf did not exist and we fell back to the deepest ancestor. */
  leafExists: boolean
}

/**
 * Resolve `rel` against `root` via realpath, clamped so symlinks can't escape.
 * If the leaf (or several trailing segments) don't exist yet, walk up to the
 * deepest existing ancestor, realpath it, and re-join the non-existent tail —
 * callers doing new-file writes can still use the result, while escape attempts
 * through non-existent paths are still caught. Callers then enforce
 * `resolved === root || startsWith(root + sep)`.
 *
 * Throws ENOENT errors as-is when no existing ancestor is found.
 */
export async function resolveWithDeepestAncestor(
  root: string,
  rel: string,
): Promise<ResolveResult> {
  const candidate = path.resolve(root, rel)
  try {
    const resolved = await fsp.realpath(candidate)
    return { resolved, leafExists: true }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err

    let cur = path.dirname(candidate)
    const tail = [path.basename(candidate)]
    while (true) {
      try {
        const realCur = await fsp.realpath(cur)
        return { resolved: path.join(realCur, ...tail), leafExists: false }
      } catch (innerErr) {
        if ((innerErr as NodeJS.ErrnoException).code !== 'ENOENT') throw innerErr
        const parent = path.dirname(cur)
        if (parent === cur) throw err
        tail.unshift(path.basename(cur))
        cur = parent
      }
    }
  }
}
