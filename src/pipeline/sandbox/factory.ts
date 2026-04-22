import type { Sandbox } from './interface'
import { LocalSubprocessSandbox } from './local-subprocess'

export function createSandbox({
  rootDir,
  yolo = false,
}: {
  rootDir: string
  yolo?: boolean
}): Sandbox {
  return new LocalSubprocessSandbox({ rootDir, clampWrites: !yolo })
}
