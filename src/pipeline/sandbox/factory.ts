import type { Sandbox } from './interface'
import { LocalSubprocessSandbox } from './local-subprocess'

export function createSandbox({ rootDir }: { rootDir: string }): Sandbox {
  return new LocalSubprocessSandbox({ rootDir })
}
