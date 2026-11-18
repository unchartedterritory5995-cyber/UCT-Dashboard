// createBarStore and the history lake: an injected feed reaches the network (a subscribed chart gets
// depth from it), the per-browser switch builds the real feed only when it says '1', and with the
// switch off no /api/hist request is ever made.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { keyOf } from './types'
import { HISTORY_LAKE_KEY } from './historyFeed'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

const OPEN = Date.UTC(2026, 10, 10, 14, 30) / 1000     // Tue 09:30 ET
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(OPEN * 1000 + 10 * 60_000) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.removeItem(HISTORY_LAKE_KEY) })

const answer = (sym, tf) => {
  const bars = []
  for (let t = OPEN; t < OPEN + 10 * 60; t += 60 * Number(tf)) bars.push({ t, o: 100, h: 101, l: 99, c: 100.5, v: 10 })
  return { bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: `b1:${sym}:${tf}:eth-clock`, series_rev: 5, history_rev: 7,
    verified_through: OPEN + 600, complete_through: OPEN + 540, developing: null, tail_status: 'verified' }
}
const makeStore = (extra = {}) => createBarStore({
  request: vi.fn(async () => answer('SIM', '1')), stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
  isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), ...extra,
})

describe('createBarStore + history lake', () => {
  it('an injected feed gives a subscribed chart older bars as soon as it is answered', async () => {
    // the lake covers the join: the rows before it and the bar AT it (historyFeed.olderBars)
    const olderBars = vi.fn(async (key, beforeT) => ({ bars: [{ t: beforeT - 120, o: 100, h: 101, l: 99, c: 100.3, v: 1 }, { t: beforeT - 60, o: 100, h: 101, l: 99, c: 100.4, v: 1 }, { t: beforeT, o: 100, h: 101, l: 99, c: 100.5, v: 1 }] }))
    const store = makeStore({ history: { olderBars } })
    const key = keyOf({ sym: 'SIM', tf: '1' })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(100)
    // one DEPTH window, from the chart's oldest bar (the open's first-paint read, network.lakeSeed, is
    // the only other ask: from "now", before the first answer)
    const depth = olderBars.mock.calls.filter((c) => c[1] === OPEN)
    expect(depth.length).toBe(1)
    expect(olderBars.mock.calls.length).toBeLessThanOrEqual(2)
    expect(store.getSnapshot(key).bars[0].t).toBe(OPEN - 120)
    off()
    store.dispose?.()
  })

  it('a chart with nothing saved paints from the lake before a slow first answer (subscribe -> hydrate -> lakeSeed)', async () => {
    let release
    const slow = vi.fn(() => new Promise((r) => { release = () => r(answer('SIM', '1')) }))
    const olderBars = vi.fn(async (key, beforeT) => ({ bars: [{ t: OPEN - 120, o: 100, h: 101, l: 99, c: 100.5, v: 1 }, { t: OPEN - 60, o: 100, h: 101, l: 99, c: 100.5, v: 1 }].filter((b) => b.t < beforeT) }))
    const store = makeStore({ request: slow, history: { olderBars } })
    const key = keyOf({ sym: 'SIM', tf: '1' })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(50)
    const s = store.getSnapshot(key)
    expect(s.restSeen).toBe(false)                         // the server has not answered ...
    expect(s.bars.map((b) => b.t)).toEqual([OPEN - 120, OPEN - 60])   // ... and the chart already has history
    release()
    await vi.advanceTimersByTimeAsync(50)
    expect(store.getSnapshot(key).restSeen).toBe(true)
    off()
    store.dispose?.()
  })

  it('the switch builds the real feed only when it says 1; off, nothing is asked of /api/hist', async () => {
    const asked = []
    vi.stubGlobal('fetch', vi.fn(async (url) => { asked.push(String(url)); return new Response('{}', { status: 404 }) }))
    for (const [value, expectLake] of [[null, false], ['0', false], ['true', false], ['1', true]]) {
      asked.length = 0
      if (value == null) localStorage.removeItem(HISTORY_LAKE_KEY); else localStorage.setItem(HISTORY_LAKE_KEY, value)
      const store = makeStore()
      const key = keyOf({ sym: 'SIM', tf: '1' })
      const off = store.subscribe(key, () => {})
      await vi.advanceTimersByTimeAsync(100)
      expect(asked.some((u) => u.startsWith('/api/hist/v1/index/s-SIM.json')), `switch ${value}`).toBe(expectLake)
      off()
      store.dispose?.()
    }
  })

  it('a lake window is as big as a piece: LAKE_WINDOW_BARS, never the server window size', async () => {
    const { LAKE_WINDOW_BARS, HISTORY_WINDOW_BARS, LAKE_PREFETCH_TARGET_BARS } = await import('../../utils/historyPrepend')
    expect(LAKE_WINDOW_BARS).toBeGreaterThan(HISTORY_WINDOW_BARS)
    const olderBars = vi.fn(async (key, beforeT) => ({ bars: [{ t: beforeT - 60, o: 100, h: 101, l: 99, c: 100.4, v: 1 }] }))
    const store = makeStore({ history: { olderBars } })
    const key = keyOf({ sym: 'SIM', tf: '1' })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(100)
    // the open's lake load (lakeSeed) is the WHOLE background depth in one go (2026-11-17)
    expect(olderBars.mock.calls[0][2].bars).toBe(LAKE_PREFETCH_TARGET_BARS)
    // every other lake read without a scroll (a depth window) is a piece's size
    for (const c of olderBars.mock.calls.slice(1)) expect(c[2].bars).toBe(LAKE_WINDOW_BARS)
    await store.scrollBack(key, { bars: HISTORY_WINDOW_BARS })                 // a scroll asking the server size
    expect(olderBars.mock.calls.at(-1)[2].bars).toBe(LAKE_WINDOW_BARS)
    off()
    store.dispose?.()
  })

  it('lakeCarries: intraday keys while the lake is on; never D, a replay window, or with no lake', async () => {
    const olderBars = vi.fn(async () => ({ bars: [], exhausted: true }))
    const on = makeStore({ history: { olderBars } })
    expect(on.lakeCarries(keyOf({ sym: 'SIM', tf: '5' }))).toBe(true)
    expect(on.lakeCarries(keyOf({ sym: 'SIM', tf: 'D' }))).toBe(false)
    expect(on.lakeCarries(keyOf({ sym: 'SIM', tf: '5', window: { to: OPEN } }))).toBe(false)
    const off = makeStore({ history: null })
    expect(off.lakeCarries(keyOf({ sym: 'SIM', tf: '5' }))).toBe(false)
    on.dispose?.(); off.dispose?.()
  })

  it('a key whose lake history ran out (exhausted) is no longer carried: the server depth target applies', async () => {
    const olderBars = vi.fn(async () => ({ bars: [], exhausted: true }))
    const store = makeStore({ history: { olderBars } })
    const key = keyOf({ sym: 'SIM', tf: '1' })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(100)
    expect(olderBars).toHaveBeenCalled()
    expect(store.lakeCarries(key)).toBe(false)
    off()
    store.dispose?.()
  })

  it('an explicit history: null wins over the switch', async () => {
    localStorage.setItem(HISTORY_LAKE_KEY, '1')
    const asked = []
    vi.stubGlobal('fetch', vi.fn(async (url) => { asked.push(String(url)); return new Response('{}', { status: 404 }) }))
    const store = makeStore({ history: null })
    const off = store.subscribe(keyOf({ sym: 'SIM', tf: '1' }), () => {})
    await vi.advanceTimersByTimeAsync(100)
    expect(asked).toEqual([])
    off()
    store.dispose?.()
  })
})
