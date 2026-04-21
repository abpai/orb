import { describe, expect, it } from 'bun:test'

import { ORB_VERSION } from './config'

async function importIndex() {
  return await import('./index')
}

describe('run', () => {
  it('handles --version before loading config or rendering the app', async () => {
    const originalWrite = process.stdout.write
    let stdout = ''

    Object.defineProperty(process.stdout, 'write', {
      value: ((chunk: string | Uint8Array) => {
        stdout += String(chunk)
        return true
      }) as typeof process.stdout.write,
      configurable: true,
    })

    try {
      const { run } = await importIndex()
      let thrown: unknown

      try {
        await run(['--version'])
      } catch (error) {
        thrown = error
      }

      expect(thrown).toMatchObject({ exitCode: 0 })
      expect(stdout.trim()).toBe(ORB_VERSION)
    } finally {
      Object.defineProperty(process.stdout, 'write', {
        value: originalWrite,
        configurable: true,
      })
    }
  })
})
