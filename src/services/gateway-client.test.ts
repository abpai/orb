import { afterEach, describe, expect, it, mock } from 'bun:test'
import { TTSError } from '../types'

async function importModule() {
  mock.restore()
  return await import('./gateway-client')
}

describe('createGatewayClient', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    mock.restore()
    globalThis.fetch = originalFetch
  })

  describe('URL normalization', () => {
    it('defaults bare URL to /v1/speech', async () => {
      const { createGatewayClient } = await importModule()
      let requestUrl: string | undefined

      globalThis.fetch = mock(async (input: string | globalThis.URL | Request) => {
        requestUrl = typeof input === 'string' ? input : input.toString()
        return new Response(new Uint8Array([1]).buffer, { status: 200 })
      }) as unknown as typeof globalThis.fetch

      await createGatewayClient('http://localhost:8000').speakSync('hello')
      expect(requestUrl).toBe('http://localhost:8000/v1/speech')
    })

    it('preserves explicit custom path', async () => {
      const { createGatewayClient } = await importModule()
      let requestUrl: string | undefined

      globalThis.fetch = mock(async (input: string | globalThis.URL | Request) => {
        requestUrl = typeof input === 'string' ? input : input.toString()
        return new Response(new Uint8Array([1]).buffer, { status: 200 })
      }) as unknown as typeof globalThis.fetch

      await createGatewayClient('http://myserver:9000/tts').speakSync('hello')
      expect(requestUrl).toBe('http://myserver:9000/tts')
    })

    it('throws TTSError for invalid URL', async () => {
      const { createGatewayClient } = await importModule()
      expect(() => createGatewayClient('not a url')).toThrow(TTSError)
    })
  })

  describe('speakSync form data', () => {
    it('sends text and voice but never speed', async () => {
      const { createGatewayClient } = await importModule()
      let requestBody: globalThis.FormData | undefined

      globalThis.fetch = mock(
        async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
          requestBody = init?.body as globalThis.FormData
          return new Response(new Uint8Array([1]).buffer, { status: 200 })
        },
      ) as unknown as typeof globalThis.fetch

      await createGatewayClient('http://localhost:8000').speakSync('hello world', 'alba')

      expect(requestBody).toBeDefined()
      expect(requestBody!.get('text')).toBe('hello world')
      expect(requestBody!.get('voice')).toBe('alba')
      expect(requestBody!.get('speed')).toBeNull()
    })

    it('omits voice when not provided', async () => {
      const { createGatewayClient } = await importModule()
      let requestBody: globalThis.FormData | undefined

      globalThis.fetch = mock(
        async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
          requestBody = init?.body as globalThis.FormData
          return new Response(new Uint8Array([1]).buffer, { status: 200 })
        },
      ) as unknown as typeof globalThis.fetch

      await createGatewayClient('http://localhost:8000').speakSync('hello world')

      expect(requestBody!.get('voice')).toBeNull()
    })

    it('does not set an explicit Content-Type header', async () => {
      const { createGatewayClient } = await importModule()
      let requestHeaders: HeadersInit | undefined

      globalThis.fetch = mock(
        async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
          requestHeaders = init?.headers
          return new Response(new Uint8Array([1]).buffer, { status: 200 })
        },
      ) as unknown as typeof globalThis.fetch

      await createGatewayClient('http://localhost:8000').speakSync('hello')

      expect(requestHeaders).toBeUndefined()
    })
  })

  describe('voice retry', () => {
    it('retries without voice on 4xx when voice is set', async () => {
      const { createGatewayClient } = await importModule()
      const bodies: globalThis.FormData[] = []

      globalThis.fetch = mock(
        async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
          const body = init?.body as globalThis.FormData
          bodies.push(body)
          if (body.get('voice')) {
            return new Response('bad voice', { status: 400 })
          }
          return new Response(new Uint8Array([1]).buffer, { status: 200 })
        },
      ) as unknown as typeof globalThis.fetch

      await createGatewayClient('http://localhost:8000').speakSync('hello', 'alba')

      expect(bodies).toHaveLength(2)
      expect(bodies[0]!.get('voice')).toBe('alba')
      expect(bodies[1]!.get('voice')).toBeNull()
    })

    it('retries without voice on 502 (Kokoro voice-not-found)', async () => {
      const { createGatewayClient } = await importModule()
      const bodies: globalThis.FormData[] = []

      globalThis.fetch = mock(
        async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
          const body = init?.body as globalThis.FormData
          bodies.push(body)
          if (body.get('voice')) {
            return new Response('alba.pt missing', { status: 502 })
          }
          return new Response(new Uint8Array([1]).buffer, { status: 200 })
        },
      ) as unknown as typeof globalThis.fetch

      await createGatewayClient('http://localhost:8000').speakSync('hello', 'alba')

      expect(bodies).toHaveLength(2)
      expect(bodies[0]!.get('voice')).toBe('alba')
      expect(bodies[1]!.get('voice')).toBeNull()
    })

    it('does NOT retry on 503 even with voice set', async () => {
      const { createGatewayClient } = await importModule()
      let callCount = 0

      globalThis.fetch = mock(async () => {
        callCount++
        return new Response('engines unavailable', { status: 503 })
      }) as unknown as typeof globalThis.fetch

      await expect(
        createGatewayClient('http://localhost:8000').speakSync('hello', 'alba'),
      ).rejects.toBeInstanceOf(TTSError)

      expect(callCount).toBe(1)
    })

    it('does NOT retry on 504 even with voice set', async () => {
      const { createGatewayClient } = await importModule()
      let callCount = 0

      globalThis.fetch = mock(async () => {
        callCount++
        return new Response('timeout', { status: 504 })
      }) as unknown as typeof globalThis.fetch

      await expect(
        createGatewayClient('http://localhost:8000').speakSync('hello', 'alba'),
      ).rejects.toBeInstanceOf(TTSError)

      expect(callCount).toBe(1)
    })
  })

  describe('error messages', () => {
    it('maps 422 to descriptive message', async () => {
      const { createGatewayClient } = await importModule()

      globalThis.fetch = mock(
        async () => new Response('', { status: 422 }),
      ) as unknown as typeof globalThis.fetch

      try {
        await createGatewayClient('http://localhost:8000').speakSync('hello')
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(TTSError)
        expect((err as TTSError).message).toContain('empty or invalid text')
      }
    })

    it('maps 503 to descriptive message', async () => {
      const { createGatewayClient } = await importModule()

      globalThis.fetch = mock(
        async () => new Response('', { status: 503 }),
      ) as unknown as typeof globalThis.fetch

      try {
        await createGatewayClient('http://localhost:8000').speakSync('hello')
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(TTSError)
        expect((err as TTSError).message).toContain('no TTS engines running')
      }
    })

    it('includes server detail in error message when available', async () => {
      const { createGatewayClient } = await importModule()

      globalThis.fetch = mock(
        async () => new Response('engine kokoro crashed', { status: 502 }),
      ) as unknown as typeof globalThis.fetch

      try {
        await createGatewayClient('http://localhost:8000').speakSync('hello')
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(TTSError)
        expect((err as TTSError).message).toContain('engine kokoro crashed')
      }
    })
  })

  describe('content-type passthrough', () => {
    it('returns content-type from response headers', async () => {
      const { createGatewayClient } = await importModule()

      globalThis.fetch = mock(
        async () =>
          new Response(new Uint8Array([1]).buffer, {
            status: 200,
            headers: { 'content-type': 'audio/wav' },
          }),
      ) as unknown as typeof globalThis.fetch

      const result = await createGatewayClient('http://localhost:8000').speakSync('hello')
      expect(result.contentType).toBe('audio/wav')
    })

    it('defaults to audio/mpeg when no content-type header', async () => {
      const { createGatewayClient } = await importModule()

      globalThis.fetch = mock(
        async () => new Response(new Uint8Array([1]).buffer, { status: 200 }),
      ) as unknown as typeof globalThis.fetch

      const result = await createGatewayClient('http://localhost:8000').speakSync('hello')
      expect(result.contentType).toBe('audio/mpeg')
    })
  })

  describe('abort signal', () => {
    it('threads signal to fetch', async () => {
      const { createGatewayClient } = await importModule()
      let receivedSignal: AbortSignal | undefined

      globalThis.fetch = mock(
        async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
          receivedSignal = init?.signal as AbortSignal | undefined
          return new Response(new Uint8Array([1]).buffer, { status: 200 })
        },
      ) as unknown as typeof globalThis.fetch

      const controller = new AbortController()
      await createGatewayClient('http://localhost:8000').speakSync(
        'hello',
        undefined,
        controller.signal,
      )

      expect(receivedSignal).toBe(controller.signal)
    })
  })

  describe('speakStream', () => {
    it('sends JSON payload and header', async () => {
      const { createGatewayClient } = await importModule()
      let parsedBody: Record<string, unknown> | undefined
      let requestHeaders: HeadersInit | undefined

      globalThis.fetch = mock(
        async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
          parsedBody = JSON.parse(init?.body as string)
          requestHeaders = init?.headers
          return new Response(new ReadableStream(), { status: 200 })
        },
      ) as unknown as typeof globalThis.fetch

      await createGatewayClient('http://localhost:8000').speakStream('hello world', 'alba')

      expect(parsedBody).toBeDefined()
      expect(parsedBody!.text).toBe('hello world')
      expect(parsedBody!.voice).toBe('alba')
      expect(requestHeaders).toEqual({ 'Content-Type': 'application/json' })
    })

    it('posts to /tts/stream endpoint by default', async () => {
      const { createGatewayClient } = await importModule()
      let requestUrl: string | undefined

      globalThis.fetch = mock(async (input: string | globalThis.URL | Request) => {
        requestUrl = typeof input === 'string' ? input : input.toString()
        return new Response(new ReadableStream(), { status: 200 })
      }) as unknown as typeof globalThis.fetch

      await createGatewayClient('http://localhost:8000').speakStream('hello')
      expect(requestUrl).toBe('http://localhost:8000/tts/stream')
    })

    it('returns ReadableStream on success', async () => {
      const { createGatewayClient } = await importModule()
      const fakeStream = new ReadableStream()

      globalThis.fetch = mock(
        async () => new Response(fakeStream, { status: 200 }),
      ) as unknown as typeof globalThis.fetch

      const stream = await createGatewayClient('http://localhost:8000').speakStream('hello')
      expect(stream).toBeInstanceOf(ReadableStream)
    })

    it('retries without voice on retriable errors', async () => {
      const { createGatewayClient } = await importModule()
      const bodies: Record<string, unknown>[] = []

      globalThis.fetch = mock(
        async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
          const body = JSON.parse(init?.body as string)
          bodies.push(body)
          if (body.voice) {
            return new Response('bad voice', { status: 400 })
          }
          return new Response(new ReadableStream(), { status: 200 })
        },
      ) as unknown as typeof globalThis.fetch

      await createGatewayClient('http://localhost:8000').speakStream('hello', 'alba')

      expect(bodies).toHaveLength(2)
      expect(bodies[0]!.voice).toBe('alba')
      expect(bodies[1]!.voice).toBeUndefined()
    })

    it('throws TTSError on non-OK response', async () => {
      const { createGatewayClient } = await importModule()

      globalThis.fetch = mock(
        async () => new Response('engines unavailable', { status: 503 }),
      ) as unknown as typeof globalThis.fetch

      await expect(
        createGatewayClient('http://localhost:8000').speakStream('hello'),
      ).rejects.toBeInstanceOf(TTSError)
    })

    it('throws TTSError when response has no body', async () => {
      const { createGatewayClient } = await importModule()

      globalThis.fetch = mock(async () => {
        // Construct a response with null body
        const resp = new Response(null, { status: 200 })
        return resp
      }) as unknown as typeof globalThis.fetch

      await expect(
        createGatewayClient('http://localhost:8000').speakStream('hello'),
      ).rejects.toBeInstanceOf(TTSError)
    })

    it('threads signal to fetch', async () => {
      const { createGatewayClient } = await importModule()
      let receivedSignal: AbortSignal | undefined

      globalThis.fetch = mock(
        async (_input: string | globalThis.URL | Request, init?: RequestInit) => {
          receivedSignal = init?.signal as AbortSignal | undefined
          return new Response(new ReadableStream(), { status: 200 })
        },
      ) as unknown as typeof globalThis.fetch

      const controller = new AbortController()
      await createGatewayClient('http://localhost:8000').speakStream(
        'hello',
        undefined,
        controller.signal,
      )

      expect(receivedSignal).toBe(controller.signal)
    })
  })
})
