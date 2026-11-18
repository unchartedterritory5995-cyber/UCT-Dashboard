// A list a member opens warms the edge's copy of its tickers' intraday history (2026-11-18, historyFeed
// edgeWarm): the chart's timeframe first, then 60m / 30m / 5m; one key at a time; each key once per page;
// capped; nothing for a store without the lake.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'
import { parseKey } from './types'

const tfOf = (k) => String(parseKey(k)?.tf)

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime((OPEN + 32 * 60) * 1000)
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot({ lake = true } = {}) {
  vi.resetModules()
  installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const { createPrefetch, EDGE_WARM_DELAY_MS, EDGE_WARM_CAP } = await import('./prefetch')
  const order = []
  let inFlight = 0, peak = 0
  const history = lake ? {
    olderBars: vi.fn(async () => ({ bars: [] })), prime: vi.fn(), hasSymbol: vi.fn(async () => true),
    edgeWarm: vi.fn(async (key) => {
      order.push(String(key)); inFlight++; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5)); inFlight--; return 3
    }),
  } : null
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history,
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { pf, history, order, peak: () => peak, EDGE_WARM_DELAY_MS, EDGE_WARM_CAP }
}

describe('the edge warm of a list', () => {
  it('starts after the list\'s own bars, chart timeframe first, one key at a time, each key once', async () => {
    const w = await boot()
    w.pf.edgeWarmList(['AAA', 'BBB'], { chartTf: '30' })
    await vi.advanceTimersByTimeAsync(w.EDGE_WARM_DELAY_MS - 10)
    expect(w.history.edgeWarm).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(w.order.length).toBe(6)                                          // 2 tickers x 30/60/5
    expect(w.order.slice(0, 2).every((k) => tfOf(k) === '30')).toBe(true)      // the chart's timeframe first
    expect(w.order.slice(2, 4).every((k) => tfOf(k) === '60')).toBe(true)
    expect(new Set(w.order).size).toBe(6)
    expect(w.peak()).toBe(1)
    w.pf.edgeWarmList(['AAA', 'BBB'], { chartTf: '30' })                    // the same list again: nothing new
    await vi.advanceTimersByTimeAsync(w.EDGE_WARM_DELAY_MS + 200)
    expect(w.order.length).toBe(6)
  })

  it('a daily chart still warms the intraday depth; the cap bounds a long list', async () => {
    const w = await boot()
    const many = Array.from({ length: w.EDGE_WARM_CAP + 20 }, (_, i) => `T${i}`)
    w.pf.edgeWarmList(many, { chartTf: 'D' })
    await vi.advanceTimersByTimeAsync(w.EDGE_WARM_DELAY_MS + 20 * 3 * w.EDGE_WARM_CAP)
    expect(w.order.length).toBe(3 * w.EDGE_WARM_CAP)
    expect(w.order.slice(0, w.EDGE_WARM_CAP).every((k) => tfOf(k) === '60')).toBe(true)
  })

  it('a store without the lake warms nothing', async () => {
    const w = await boot({ lake: false })
    w.pf.edgeWarmList(['AAA'], { chartTf: '60' })
    await vi.advanceTimersByTimeAsync(w.EDGE_WARM_DELAY_MS + 100)
    expect(w.order.length).toBe(0)
  })
})
