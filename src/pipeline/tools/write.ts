import { tool } from 'ai'
import { z } from 'zod'
import { ctxFrom } from './context.ts'

export const writeFile = tool({
  description: 'Write UTF-8 content to a file in the sandbox (relative to the project root).',
  inputSchema: z.object({
    path: z.string().describe('Path to write, relative to the project root.'),
    content: z.string().describe('UTF-8 file content to write.'),
  }),
  async execute(input, options) {
    const { sandbox, signal } = ctxFrom(options)
    try {
      await sandbox.writeFile(input.path, input.content, { signal })
      return { success: true as const }
    } catch (err) {
      return { error: (err as Error).message, isError: true as const }
    }
  },
})
