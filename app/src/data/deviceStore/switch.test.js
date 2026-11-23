// THE SWITCH: localStorage 'uct.deviceStore' ('1' on, '0' off), DEFAULT OFF in this PR. Off, the
// BarStore never asks the device store and nothing of it loads (the client module is never imported);
// on, a key with nothing saved asks it for (sym, cacheTf).
// ⭐ ONE DECISION PER PAGE LOAD (review of #2537, M3): the switch is read when the BarStore is created
// (persist.js), at the handoff's module scope (hooks/useSymbolHandoff.js) and by the handoff's diagnostics
// (source.deviceSource, on every switch). Those reads are moments apart, so the FIRST answer is the page's
// answer: two reads on one page can never disagree, and the diagnostics can never start the client (worker,
// ingest, minute feed) for a page whose bar store decided OFF. Only the server's kill still wins on every read.
// A "page load" here is a fresh module graph (vi.resetModules), never a reset hook of the module under test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DEVICE_STORE_KEY, DEVICE_STORE_DEFAULT_ON } from './switch'
import { CHART_SPEED_COOKIE } from '../../lib/chartSpeed'

const fakeClient = {
  start() { return this },
  peekBars: vi.fn(() => null),
  getBars: vi.fn(async () => ({ t: Float64Array.of(1794000000), o: Float64Array.of(1), h: Float64Array.of(2), l: Float64Array.of(0.5), c: Float64Array.of(1.5), v: Float64Array.of(10), build: '20261119T0131Z', through: 1794000300 })),
  why: vi.fn(async () => 'ok'),
}
const getDeviceClient = vi.fn(() => fakeClient)
vi.mock('./client', () => ({ getDeviceClient }))

const clearKill = () => { document.cookie = `${CHART_SPEED_COOKIE}=; max-age=0; path=/` }
beforeEach(() => { localStorage.removeItem(DEVICE_STORE_KEY); clearKill(); getDeviceClient.mockClear(); fakeClient.getBars.mockClear(); fakeClient.peekBars.mockClear(); fakeClient.why.mockClear() })
afterEach(() => { localStorage.removeItem(DEVICE_STORE_KEY); clearKill(); vi.useRealTimers() })

/** A new page load: the switch, the kill switch and everything else evaluated afresh. */
async function pageLoad() {
  vi.resetModules()
  const sw = await import('./switch')
  const speed = await import('../../lib/chartSpeed')
  return { sw, speed }
}

const storeOpts = () => ({
  request: () => new Promise(() => {}), history: null,
  io: { idbGet: async () => null, idbGetHistoryEntry: async () => null },
  stream: { subscribe: () => () => {}, getStatus: () => ({ delivering: false }) }, candle: null, prices: null,
  isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
})
/** Bounded wait for the lazy client import (see hydrateOnce). */
const settle = async (until = () => false) => { for (let i = 0; i < 40 && !until(); i++) await new Promise((r) => setTimeout(r, 20)) }

describe('the device store switch', () => {
  it('a seed build id is read as its UTC time (the device copy savedAt); anything else is null', async () => {
    const { buildTimeMs } = await import('./source')
    expect(buildTimeMs('20261119T0131Z')).toBe(Date.UTC(2026, 10, 19, 1, 31))
    expect(buildTimeMs('2026-11-19')).toBeNull()
    expect(buildTimeMs(null)).toBeNull()
  })

  it('is OFF by default in this PR; "1" turns it on, "0" off (each read on its own page load)', async () => {
    expect(DEVICE_STORE_DEFAULT_ON).toBe(false)
    expect((await pageLoad()).sw.deviceStoreEnabled()).toBe(false)
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    expect((await pageLoad()).sw.deviceStoreEnabled()).toBe(true)
    localStorage.setItem(DEVICE_STORE_KEY, '0')
    expect((await pageLoad()).sw.deviceStoreEnabled()).toBe(false)
  })

  // L1 (review of #2537): only '1' means on and only '0' off. Anything else is not read as a choice: it answers
  // exactly what an absent key answers (the default), so a member who typed 'off', 'false' or 'true' is never
  // switched ON by it while the default is OFF.
  it('L1 a key that is neither "1" nor "0" reads exactly as an absent key (never ON while the default is OFF)', async () => {
    const absent = (await pageLoad()).sw.deviceStoreEnabled()
    expect(absent).toBe(DEVICE_STORE_DEFAULT_ON)
    expect(absent).toBe(false)
    for (const v of ['true', 'on', 'yes', 'off', 'false', '', ' 1', '1 ', '01', 'null']) {
      localStorage.setItem(DEVICE_STORE_KEY, v)
      expect((await pageLoad()).sw.deviceStoreEnabled(), JSON.stringify(v)).toBe(absent)
    }
  })

  it('M3 ONE decision per page load: a key that changes after the first read changes nothing until the next load', async () => {
    const off = (await pageLoad()).sw
    expect(off.deviceStoreEnabled()).toBe(false)
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    expect(off.deviceStoreEnabled()).toBe(false)                    // the same page: its first answer
    const on = (await pageLoad()).sw
    expect(on.deviceStoreEnabled()).toBe(true)                      // the next load reads the key
    localStorage.setItem(DEVICE_STORE_KEY, '0')
    expect(on.deviceStoreEnabled()).toBe(true)
    expect(on.deviceStoreEnabled()).toBe(true)
  })

  it('M3 the server kill still wins on EVERY read, over a page that already answered ON', async () => {
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    const { sw, speed } = await pageLoad()
    expect(sw.deviceStoreEnabled()).toBe(true)
    // (the kill is latched once per page by lib/chartSpeed; forgetting that latch is the only way a test can show
    // a kill arriving after the switch has answered)
    document.cookie = `${CHART_SPEED_COOKIE}=0; path=/`
    speed.__resetChartSpeedForTests()
    expect(sw.deviceStoreEnabled()).toBe(false)
  })

  it('M3 the bar store decided OFF: a key turned on later never starts the client, the diagnostics\' source included', async () => {
    vi.resetModules()
    const { createBarStore } = await import('../barStore/index')
    const { keyOf } = await import('../barStore/types')
    const store = createBarStore(storeOpts())                       // persist reads the switch: no key, OFF
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    // what the handoff's diagnostics ask on every switch (hooks/useSymbolHandoff: deviceWhy, the queue count)
    const { deviceSource } = await import('./source')
    const src = deviceSource()
    expect(src).toBeNull()
    await (src ? src.why('NEWB', '5') : Promise.resolve('no-client'))
    await store.persist.hydrate(keyOf({ sym: 'NEWB', tf: '5' }))
    await settle(() => getDeviceClient.mock.calls.length > 0)
    expect(getDeviceClient).not.toHaveBeenCalled()
    store.dispose()
  })

  it('M3 ...and a bar store that decided ON keeps its source when the key is turned off on the same page', async () => {
    localStorage.setItem(DEVICE_STORE_KEY, '1')
    vi.resetModules()
    const { createBarStore } = await import('../barStore/index')
    const store = createBarStore(storeOpts())
    localStorage.setItem(DEVICE_STORE_KEY, '0')
    const { deviceSource } = await import('./source')
    expect(deviceSource()).not.toBeNull()                           // the diagnostics agree with the store
    store.dispose()
  })

  async function hydrateOnce() {
    vi.resetModules()
    const { createBarStore } = await import('../barStore/index')
    const { keyOf } = await import('../barStore/types')
    const store = createBarStore(storeOpts())
    const key = keyOf({ sym: 'NEWB', tf: '5' })
    await store.persist.hydrate(key)
    // ⛔ NOT A FIXED WAIT: the device read is lazy (a dynamic import of the client, cold after resetModules), and on
    // a loaded CI runner it outlasted a flat 20 ms (remote tests, 2026-11-20: getDeviceClient called 0 times). Wait
    // for its copy, bounded: on, it lands well inside the bound; off, nothing may load in the whole window.
    await settle(() => store.peek(key)?.source === 'device')
    const s = { ...store.peek(key), savedAt: store.persist.savedAtOf(key), through: store.persist.deviceThroughOf(key) }
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
    expect(s.through).toBe(1794000300)                                   // its stamp, not the build time
    expect(s.savedAt).toBe(1794000300 * 1000)
  })
})
