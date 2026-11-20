// THE SWITCH: localStorage 'uct.deviceStore' ('1' on, '0' off), DEFAULT OFF in this PR. Off, the
// BarStore never asks the device store and nothing of it loads (the client module is never imported);
// on, a key with nothing saved asks it for (sym, cacheTf).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DEVICE_STORE_KEY, DEVICE_STORE_DEFAULT_ON, deviceStoreEnabled } from './switch'

const fakeClient = {
  start() { return this },
  peekBars: vi.fn(() => null),
  getBars: vi.fn(async () => ({ t: Float64Array.of(1794000000), o: Float64Array.of(1), h: Float64Array.of(2), l: Float64Array.of(0.5), c: Float64Array.of(1.5), v: Float64Array.of(10), build: null })),
}
const getDeviceClient = vi.fn(() => fakeClient)
vi.mock('./client', () => ({ getDeviceClient }))

beforeEach(() => { localStorage.removeItem(DEVICE_STORE_KEY); getDeviceClient.mockClear(); fakeClient.getBars.mockClear(); fakeClient.peekBars.mockClear() })
afterEach(() => { localStorage.removeItem(DEVICE_STORE_KEY); vi.useRealTimers() })

describe('the device store switch', () => {
  it('a seed build id is read as its UTC time (the device copy savedAt); anything else is null', async () => {
    const { buildTimeMs } = await import('./source')
    expect(buildTimeMs('20261119T0131Z')).toBe(Date.UTC(2026, 10, 19, 1, 31))
    expect(buildTimeMs('2026-11-19')).toBeNull()
    expect(buildTimeMs(null)).toBeNull()
  })

  it('is OFF by default in this PR; "1" turns it on, "0" off', () => {
    expect(DEVICE_STORE_DEFAULT_ON).toBe(false)
    expect(deviceStoreEnabled()).toBe(false)
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    expect(deviceStoreEnabled()).toBe(true)
    localStorage.setItem(DEVICE_STORE_KEY, '0')
    expect(deviceStoreEnabled()).toBe(false)
  })

  async function hydrateOnce() {
    vi.resetModules()
    const { createBarStore } = await import('../barStore/index')
    const { keyOf } = await import('../barStore/types')
    const store = createBarStore({
      request: () => new Promise(() => {}), history: null,
      io: { idbGet: async () => null, idbGetHistoryEntry: async () => null },
      stream: { subscribe: () => () => {}, getStatus: () => ({ delivering: false }) }, candle: null, prices: null,
      isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    })
    const key = keyOf({ sym: 'NEWB', tf: '5' })
    await store.persist.hydrate(key)
    await new Promise((r) => setTimeout(r, 20))
    const s = store.peek(key)
    store.dispose()
    return s
  }

  it('off: the BarStore never loads the device client and holds nothing for a never-seen key', async () => {
    const s = await hydrateOnce()
    expect(getDeviceClient).not.toHaveBeenCalled()
    expect(s.bars.length).toBe(0)
  })

  it('on: a never-seen key loads the client lazily and takes its copy (sym, cache tf)', async () => {
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    const s = await hydrateOnce()
    expect(getDeviceClient).toHaveBeenCalledTimes(1)
    expect(fakeClient.getBars).toHaveBeenCalledWith('NEWB', '5')
    expect(s.source).toBe('device')
    expect(s.bars.length).toBe(1)
  })
})
