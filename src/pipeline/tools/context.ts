import type { Sandbox } from '../sandbox/interface.ts'

export interface ToolCtx {
  sandbox: Sandbox
  signal: AbortSignal
}

export function ctxFrom(options: { experimental_context?: unknown }): ToolCtx {
  const ctx = options.experimental_context as ToolCtx | undefined
  if (!ctx || !ctx.sandbox || !ctx.signal) {
    throw new Error('tool invoked without experimental_context {sandbox, signal}')
  }
  return ctx
}
