import { describe, expect, it } from 'bun:test'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'

import { wrapFfplayProcess, type FfplayProcessLike } from './audio-player'

// Drives wrapFfplayProcess with a real node:stream Writable so the tests
// exercise the same callback/close semantics as the ffplay pipe on Bun —
// including the case Bun never settles on its own: a write pending on a full
// pipe when the player dies.
function createFakeFfplay(options: { acceptWrites: boolean }) {
  const written: Uint8Array[] = []
  const audioWriter = new Writable({
    write(chunk: Uint8Array, _encoding, callback) {
      written.push(new Uint8Array(chunk))
      if (options.acceptWrites) callback()
      // Otherwise leave the write pending, like a kernel pipe the player
      // stopped reading.
    },
  })
  const control = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })

  class FakeProc extends EventEmitter {
    stdin = control
    stdio: ReadonlyArray<unknown> = [control, null, null, audioWriter]
    pid = 4242
    kill() {
      this.emit('exit', null, 'SIGTERM')
    }
  }

  return { proc: new FakeProc() as unknown as FfplayProcessLike, written, audioWriter }
}

describe('wrapFfplayProcess', () => {
  it('resolves writes once the pipe accepts them', async () => {
    const { proc, written } = createFakeFfplay({ acceptWrites: true })
    const player = wrapFfplayProcess(proc)

    await player.writer.write(new Uint8Array([1, 2, 3]))

    expect(written).toEqual([new Uint8Array([1, 2, 3])])
    player.kill()
  })

  it('settles a pending pipe write when the player is killed', async () => {
    const { proc } = createFakeFfplay({ acceptWrites: false })
    const player = wrapFfplayProcess(proc)

    const pendingWrite = player.writer.write(new Uint8Array(16))
    player.kill()

    await expect(pendingWrite).rejects.toBeInstanceOf(Error)
    expect(await player.exited).toBe(1)
  })

  it('settles a pending pipe write when the player exits on its own', async () => {
    const { proc } = createFakeFfplay({ acceptWrites: false })
    const player = wrapFfplayProcess(proc)

    const pendingWrite = player.writer.write(new Uint8Array(16))
    ;(proc as unknown as EventEmitter).emit('exit', 1, null)

    await expect(pendingWrite).rejects.toBeInstanceOf(Error)
    expect(await player.exited).toBe(1)
  })

  it('resolves end() cleanly after the player was killed', async () => {
    const { proc } = createFakeFfplay({ acceptWrites: true })
    const player = wrapFfplayProcess(proc)

    player.kill()
    await expect(player.writer.end()).resolves.toBeUndefined()
  })

  it('rejects writes issued after the pipe is gone', async () => {
    const { proc } = createFakeFfplay({ acceptWrites: true })
    const player = wrapFfplayProcess(proc)

    player.kill()
    await expect(player.writer.write(new Uint8Array([1]))).rejects.toBeInstanceOf(Error)
  })
})
