// ⭐⭐ (lane C, review of #2996 F1) THE CHART'S TIMEFRAME DWELL NEVER ASKS THE ORIGIN. prefetchAllTimeframes(sym, {edge})
// reads each timeframe's key from the device and the edge (D/W/M: the edge's deep history; intraday: the lake's pieces)
// and sends no /api/bars (an origin `&warm=1` per timeframe per 300 ms rest was ~3,500/s at 500 scanning members); a
// signal aborted when the member leaves the symbol asks nothing more.
//   E1 edge: every timeframe of the bar warmed, no /api/bars
//   E2 aborted before the warm runs: nothing asked at all
//   E3 CONTROL: without `edge` (the list's dwell, unchanged) the origin warms go out, so E1 can fail
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')
  localStorage.removeItem('uct.barsHistory.enabled')
  localStorage.setItem('uct.barsHistory.bucket', '5')
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem('barspack.version'); localStorage.removeItem('uct.barsHistory.bucket'); localStorage.removeItem('uct.tickerUniverse')
})

async function boot() {
  vi.resetModules()
  const server = installFakeBarsServer()
  const tu = await import('../../lib/tickerUniverse')
  tu.__resetTickerUniverseForTests()
  await tu.ensureTickerUniverse({ fetchImpl: async () => ({ ok: true, json: async () => ({ v: 't1', symbols: ['AAA', 'NVDA'] }) }) })
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const store = createBarStore({ stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn() })
  store.lakeHas = () => Promise.resolve(false)
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, store, pf }
}
const settle = async (w) => { for (let i = 0; i < 4; i++) { await w.server.flush(60); await vi.advanceTimersByTimeAsync(1); await w.server.flush(60) } }
const origin = (w) => w.server.calls.filter((c) => !c.q.history)
const TFS = ['D', 'W', 'M', '5', '15', '60']

describe('the chart\'s timeframe dwell: device and edge only', () => {
  it('E1 edge: no /api/bars for any timeframe', async () => {
    const w = await boot()
    w.pf.prefetchAllTimeframes('NVDA', { tfs: TFS, edge: true, signal: new AbortController().signal })
    await settle(w)
    await w.server.drain()
    expect(origin(w).map((c) => `${c.q.sym} ${c.q.tf}`)).toEqual([])
    expect(w.server.calls.some((c) => c.q.history && c.q.tf === 'D'), 'the D key asked the edge its history').toBe(true)
  })

  it('E2 the member left before the warm ran: nothing asked', async () => {
    const w = await boot()
    const ctl = new AbortController()
    w.pf.prefetchAllTimeframes('NVDA', { tfs: TFS, edge: true, signal: ctl.signal })
    ctl.abort()
    await settle(w)
    await w.server.drain()
    expect(w.server.calls).toEqual([])
  })

  it('E3 CONTROL: without edge (the list\'s dwell) the origin warms go out', async () => {
    const w = await boot()
    w.pf.prefetchAllTimeframes('NVDA', { tfs: TFS })
    await settle(w)
    await vi.advanceTimersByTimeAsync(5000)
    await settle(w)
    await w.server.drain()
    expect(origin(w).length).toBeGreaterThan(0)
  })
})
