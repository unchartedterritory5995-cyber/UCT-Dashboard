// Review of #2580 (LOW): the bar store's kill watcher is registered ONLY when it has a device source. persist.js registers
// `lib/chartSpeed.onDeviceStoreKill` behind `DEV ? ... : null`; with the store off no entry ever holds device rows, so a
// watcher would find nothing to do and the guard could not be proved by behaviour. It is proved by registration:
//   PW1 no device source (`device: null`): the watcher is never registered
//   PW2 the app's default source with the device store switched off: never registered either
//   PW3 the control: with a device source it is registered, once, and the store's dispose removes it
import { describe, it, expect, vi, beforeEach } from 'vitest'

const W = vi.hoisted(() => ({ on: null, off: null }))
vi.mock('../../lib/chartSpeed', async (orig) => {
  const m = await orig()
  return { ...m, onDeviceStoreKill: (...a) => W.on(...a) }
})
const { createPersist } = await import('./persist')
const { createRegistry } = await import('./registry')

const NO_IO = {
  memPeekEntry: () => null, idbGet: async () => null, idbGetHistoryEntry: async () => null,
  memPutMonotonic: () => {}, idbPutMonotonic: async () => {}, idbPutHistory: async () => {},
}

beforeEach(() => {
  W.off = vi.fn()
  W.on = vi.fn(() => W.off)
  try { localStorage.removeItem('uct.deviceStore') } catch { /* jsdom has it */ }
})

describe('the kill watcher is registered only with a device source', () => {
  it('PW1 no device source: never registered', () => {
    createPersist({ registry: createRegistry(), io: NO_IO, device: null })
    expect(W.on).not.toHaveBeenCalled()
  })

  it('PW2 the default source with the device store off: never registered', () => {
    createPersist({ registry: createRegistry(), io: NO_IO })
    expect(W.on).not.toHaveBeenCalled()
  })

  it('PW3 the control: a device source registers it once; dispose removes it', () => {
    const p = createPersist({ registry: createRegistry(), io: NO_IO, device: { peek: () => null, read: async () => null } })
    expect(W.on).toHaveBeenCalledTimes(1)
    p.dispose()
    expect(W.off).toHaveBeenCalledTimes(1)
  })
})
