import { tool } from 'ai'
import { z } from 'zod'
import { ctxFrom } from './context.ts'

function composeSignal(adapterSignal: AbortSignal, timeoutMs?: number): AbortSignal {
  if (!timeoutMs) return adapterSignal
  return AbortSignal.any([adapterSignal, AbortSignal.timeout(timeoutMs)])
}

export const bash = tool({
  description: 'Run a shell command inside the sandbox via `bash -lc`.',
  inputSchema: z.object({
    command: z.string().describe('Shell command to run via bash -lc.'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Optional per-call timeout in milliseconds.'),
    cwd: z.string().optional().describe('Optional working directory relative to the project root.'),
  }),
  async execute(input, options) {
    const { sandbox, signal } = ctxFrom(options)
    const combined = composeSignal(signal, input.timeoutMs)
    return await sandbox.exec('bash', ['-lc', input.command], {
      cwd: input.cwd,
      signal: combined,
    })
  },
})
