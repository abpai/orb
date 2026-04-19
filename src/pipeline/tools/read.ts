import { tool } from 'ai'
import { z } from 'zod'
import { ctxFrom } from './context.ts'

export const readFile = tool({
  description:
    'Read a UTF-8 file. Absolute paths are allowed; relative paths resolve against the project root.',
  inputSchema: z.object({
    path: z.string().describe('Absolute path, or path relative to the project root.'),
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
