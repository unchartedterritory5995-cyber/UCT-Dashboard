// Final fix (B4): lib/heldModule.js. A loader that throws synchronously must not strand the slot at `loading`: it is
// a failed fetch (`failed`), warm() never throws, and the next warm() asks again.
import { describe, it, expect, vi } from 'vitest'
import { heldModule } from './heldModule'

const Real = () => null

describe('heldModule', () => {
  it('a loader that throws synchronously: warm() does not throw, the slot is `failed`, and the next warm() asks again', async () => {
    let calls = 0
    const load = vi.fn(() => {
      calls += 1
      if (calls === 1) throw new Error('boom before any promise')
      return Promise.resolve({ default: Real })
    })
    const held = heldModule(load, 0)
    let out
    expect(() => { out = held.warm() }).not.toThrow()
    expect(await out).toBeNull()
    expect(held.get().status).toBe('failed')
    expect(await held.warm()).toBe(Real)
    expect(held.get()).toMatchObject({ status: 'ready', Component: Real })
  })

  it('a loader that rejects: `failed`, then recovers on the next warm()', async () => {
    let calls = 0
    const held = heldModule(() => { calls += 1; return calls === 1 ? Promise.reject(new Error('no')) : Promise.resolve({ default: Real }) }, 0)
    expect(await held.warm()).toBeNull()
    expect(held.get().status).toBe('failed')
    expect(await held.warm()).toBe(Real)
  })

  it('CONTROL: a loader that resolves is `ready` after one warm, and a second warm does not load again', async () => {
    const load = vi.fn(() => Promise.resolve({ default: Real }))
    const held = heldModule(load, 0)
    expect(held.get().status).toBe('idle')
    const p = held.warm()
    expect(held.get().status).toBe('loading')
    expect(await p).toBe(Real)
    await held.warm()
    expect(load).toHaveBeenCalledTimes(1)
  })
})
