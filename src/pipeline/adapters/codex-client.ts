// JSON-RPC-over-stdio transport for the `codex app-server` subprocess.
//
// This is pure transport: it spawns the process, frames newline-delimited
// JSON-RPC messages, correlates request ids to responses, and exposes server
// notifications as an async iterable. It holds no OpenAI/Codex domain logic —
// method names and params live in the adapter.

export type JsonRpcId = number

export interface JsonRpcMessage {
  id?: JsonRpcId
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

class AsyncMessageQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = []
  private closed = false

  push(value: T): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value, done: false })
      return
    }
    this.values.push(value)
  }

  end(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as T, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift()
        if (value !== undefined) return Promise.resolve({ value, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true })
        return new Promise((resolve) => this.waiters.push(resolve))
      },
    }
  }
}

export class CodexAppServerClient {
  private readonly proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
  private readonly encoder = new TextEncoder()
  private readonly pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private readonly queue = new AsyncMessageQueue<JsonRpcMessage>()
  private nextId = 1
  private stderrText = ''

  constructor() {
    this.proc = Bun.spawn({
      cmd: ['codex', 'app-server'],
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    void this.readStdout()
    void this.readStderr()
  }

  notifications(): AsyncIterable<JsonRpcMessage> {
    return this.queue
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    await this.write({ method, id, params })
    return response
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.write({ method, params })
  }

  async respond(id: JsonRpcId, result: unknown): Promise<void> {
    await this.write({ id, result })
  }

  async close(): Promise<void> {
    this.queue.end()
    for (const { reject } of this.pending.values()) {
      reject(new Error('Codex app-server closed before responding.'))
    }
    this.pending.clear()

    try {
      await this.proc.stdin.end()
    } catch {
      // Process may already be gone.
    }
    this.proc.kill()
    await this.proc.exited.catch(() => {})
  }

  private async write(message: JsonRpcMessage): Promise<void> {
    this.proc.stdin.write(this.encoder.encode(`${JSON.stringify(message)}\n`))
    await this.proc.stdin.flush()
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (message.id !== undefined && !message.method) {
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) {
        waiter.reject(new Error(message.error.message ?? `Codex app-server error ${message.id}`))
      } else {
        waiter.resolve(message.result)
      }
      return
    }

    this.queue.push(message)
  }

  private async readStdout(): Promise<void> {
    const decoder = new TextDecoder()
    const reader = this.proc.stdout.getReader()
    let buffer = ''

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
          const line = buffer.slice(0, newlineIndex).trim()
          buffer = buffer.slice(newlineIndex + 1)
          if (line) this.handleMessage(JSON.parse(line) as JsonRpcMessage)
          newlineIndex = buffer.indexOf('\n')
        }
      }
      const finalLine = buffer.trim()
      if (finalLine) this.handleMessage(JSON.parse(finalLine) as JsonRpcMessage)
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      for (const { reject } of this.pending.values()) reject(err)
      this.pending.clear()
    } finally {
      this.queue.end()
    }
  }

  private async readStderr(): Promise<void> {
    try {
      this.stderrText = await new Response(this.proc.stderr).text()
    } catch {
      this.stderrText = ''
    }
  }

  getStderrText(): string {
    return this.stderrText.trim()
  }
}
