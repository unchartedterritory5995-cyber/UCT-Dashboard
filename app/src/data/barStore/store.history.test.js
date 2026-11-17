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
    const olderBars = vi.fn(async (key, beforeT) => ({ bars: [{ t: beforeT - 120, o: 100, h: 101, l: 99, c: 100.3, v: 1 }, { t: beforeT - 60, o: 100, h: 101, l: 99, c: 100.4, v: 1 }] }))
    const store = makeStore({ history: { olderBars } })
    const key = keyOf({ sym: 'SIM', tf: '1' })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(100)
    expect(olderBars).toHaveBeenCalledTimes(1)
    expect(olderBars.mock.calls[0][1]).toBe(OPEN)
    expect(store.getSnapshot(key).bars[0].t).toBe(OPEN - 120)
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
