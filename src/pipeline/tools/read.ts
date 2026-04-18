import { tool } from 'ai'
import { z } from 'zod'
import { ctxFrom } from './context.ts'

export const readFile = tool({
  description: 'Read a file from the sandbox (relative to the project root).',
  inputSchema: z.object({
    path: z.string().describe('Path to read, relative to the project root.'),
  }),
  async execute(input, options) {
    const { sandbox, signal } = ctxFrom(options)
    try {
      const content = await sandbox.readFile(input.path, { signal })
      return { content }
    } catch (err) {
      return { error: (err as Error).message, isError: true as const }
    }
  },
})
