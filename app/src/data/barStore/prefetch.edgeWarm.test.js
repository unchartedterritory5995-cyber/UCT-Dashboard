// A list a member views on an INTRADAY chart warms the edge's copy of its top rows' history (2026-11-18,
// historyFeed edgeWarm). Bounded (review of #1880): the chart's timeframe then 60m only; EDGE_WARM_CAP
// rows; a new list replaces the queue; EDGE_WARM_PAGE_BUDGET keys a page; a hidden tab pauses; a 401/403
// stops it; a daily list warms nothing; each key once; one key at a time, after the latest list's delay.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'
import { parseKey } from './types'

const tfOf = (k) => String(parseKey(k)?.tf)
const symOf = (k) => String(parseKey(k)?.sym)

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

async function boot({ lake = true, answer = 3 } = {}) {
  vi.resetModules()
  installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const P = await import('./prefetch')
  const order = []
  let inFlight = 0, peak = 0
  const history = lake ? {
    olderBars: vi.fn(async () => ({ bars: [] })), prime: vi.fn(), hasSymbol: vi.fn(async () => true),
    edgeWarm: vi.fn(async (key) => {
      order.push(String(key)); inFlight++; peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5)); inFlight--; return answer
    }),
  } : null
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history,
  })
  const pf = P.createPrefetch({ store, tickerMeta: () => {} })
  return { pf, history, order, peak: () => peak, P }
}
const run = (ms) => vi.advanceTimersByTimeAsync(ms)

describe('the edge warm of a list', () => {
  it('chart timeframe then 60m, after the delay, one key at a time, each key once', async () => {
    const w = await boot()
    w.pf.edgeWarmList(['AAA', 'BBB'], { chartTf: '30' })
    await run(w.P.EDGE_WARM_DELAY_MS - 10)
    expect(w.history.edgeWarm).not.toHaveBeenCalled()
    await run(200)
    expect(w.order.map(tfOf)).toEqual(['30', '30', '60', '60'])
    expect(w.order.map(symOf)).toEqual(['AAA', 'BBB', 'AAA', 'BBB'])
    expect(w.peak()).toBe(1)
    w.pf.edgeWarmList(['AAA', 'BBB'], { chartTf: '30' })                    // the same list again: nothing new
    await run(w.P.EDGE_WARM_DELAY_MS + 200)
    expect(w.order.length).toBe(4)
  })

  it('a daily list (Market Map) warms nothing; an intraday one only its first EDGE_WARM_CAP rows', async () => {
    const w = await boot()
    const many = Array.from({ length: w.P.EDGE_WARM_CAP + 20 }, (_, i) => `T${i}`)
    w.pf.edgeWarmList(many, { chartTf: 'D' })
    await run(w.P.EDGE_WARM_DELAY_MS + 500)
    expect(w.order.length).toBe(0)
    w.pf.edgeWarmList(many, { chartTf: '60' })
    await run(w.P.EDGE_WARM_DELAY_MS + 20 * w.P.EDGE_WARM_CAP)
    expect(w.order.length).toBe(w.P.EDGE_WARM_CAP)
    expect(new Set(w.order.map(symOf))).toEqual(new Set(many.slice(0, w.P.EDGE_WARM_CAP)))
  })

  it('a new list replaces the old one\'s queue and waits its own delay', async () => {
    const w = await boot()
    w.pf.edgeWarmList(Array.from({ length: 30 }, (_, i) => `OLD${i}`), { chartTf: '60' })
    await run(w.P.EDGE_WARM_DELAY_MS + 12)                                  // a couple of OLD keys started
    const before = w.order.length
    w.pf.edgeWarmList(['NEW1', 'NEW2'], { chartTf: '60' })
    await run(w.P.EDGE_WARM_DELAY_MS - 50)
    expect(w.order.slice(before + 1).length).toBe(0)                         // the new list's delay holds (one in flight may finish)
    await run(500)
    const after = w.order.slice(before)
    expect(after.filter((k) => symOf(k).startsWith('NEW')).length).toBe(2)
    expect(after.filter((k) => symOf(k).startsWith('OLD')).length).toBeLessThanOrEqual(1)   // the old list is dropped
  })

  it('stops at the page budget, and for good on a 401/403', async () => {
    const w = await boot()
    for (let n = 0; n < 8; n++) {
      w.pf.edgeWarmList(Array.from({ length: w.P.EDGE_WARM_CAP }, (_, i) => `L${n}X${i}`), { chartTf: '60' })
      await run(w.P.EDGE_WARM_DELAY_MS + 20 * w.P.EDGE_WARM_CAP)
    }
    expect(w.order.length).toBe(w.P.EDGE_WARM_PAGE_BUDGET)
    const r = await boot({ answer: w.P.EDGE_WARM_REFUSED })
    r.pf.edgeWarmList(['AAA', 'BBB', 'CCC'], { chartTf: '60' })
    await run(r.P.EDGE_WARM_DELAY_MS + 200)
    expect(r.order.length).toBe(1)
    r.pf.edgeWarmList(['DDD'], { chartTf: '60' })
    await run(r.P.EDGE_WARM_DELAY_MS + 200)
    expect(r.order.length).toBe(1)
  })

  it('a hidden tab pauses it; the next list on a visible page resumes', async () => {
    const w = await boot()
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    w.pf.edgeWarmList(['AAA'], { chartTf: '60' })
    await run(w.P.EDGE_WARM_DELAY_MS + 200)
    expect(w.order.length).toBe(0)
    vis.mockReturnValue('visible')
    w.pf.edgeWarmList(['AAA'], { chartTf: '60' })
    await run(w.P.EDGE_WARM_DELAY_MS + 200)
    expect(w.order.length).toBe(1)
    vis.mockRestore()
  })

  it('prewarmVisibleList (Watchlists, Theme Tracker, screener) starts it; a store without the lake warms nothing', async () => {
    const w = await boot()
    w.pf.prewarmVisibleList(['AAA'], { chartTf: '5' })
    await run(w.P.EDGE_WARM_DELAY_MS + 200)
    expect(w.order.map(tfOf)).toEqual(['5', '60'])
    const n = await boot({ lake: false })
    n.pf.edgeWarmList(['AAA'], { chartTf: '60' })
    await run(n.P.EDGE_WARM_DELAY_MS + 100)
    expect(n.order.length).toBe(0)
  })
})
