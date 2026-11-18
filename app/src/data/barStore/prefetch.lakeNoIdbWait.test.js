// THE LAKE DOES NOT WAIT ON A SLOW CACHE READ (2026-11-18). Measured live (MDB 1h, never opened): the
// lake's pieces were in the browser at 862 ms, but the open's lake load waited for the IDB read (the list
// warm writes to the same database), which answered at ~1,240 ms. Contract, through prepareForDisplay:
//   W1 a slow cache read holds the lake load for HYDRATE_WAIT_MS at most
//   W2 a cache read that answers within the bound still goes first (a saved copy is never overtaken)
// (A saved copy that lands after the lake: reducer.lakeThenSaved.test.js; the depth's return after a
// replace: store.lakeRejoin.test.js.)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 10:02:20 ET, mid-session
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

// the server's own rows (fakeBarsServer intradayRows: o 10, h 11, l 9, c 10.5, v 100)
const likeServer = (from, to) => { const out = []; for (let t = from; t <= to; t += 300) out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 }); return out }

async function boot({ idbMs, idbEntry = null }) {
  vi.resetModules()
  const server = installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const { createPrefetch, HYDRATE_WAIT_MS } = await import('./prefetch')
  const { keyOf } = await import('./types')
  const log = []
  const lakeRows = likeServer(OPEN - 300 * 60, OPEN + 600)
  const history = {
    olderBars: vi.fn(async (key, beforeT) => { log.push(['lake', Date.now() - NOW]); return { bars: lakeRows.filter((b) => b.t < beforeT) } }),
    prime: vi.fn(),
    hasSymbol: vi.fn(async () => true),
  }
  const io = {
    idbGet: vi.fn(() => new Promise((r) => setTimeout(() => { log.push(['idb', Date.now() - NOW]); r(idbEntry) }, idbMs))),
    idbGetHistoryEntry: async () => null,
  }
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(), history, io,
  })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, store, pf, log, history, HYDRATE_WAIT_MS, k: (sym, tf) => keyOf({ sym, tf }) }
}

describe('the lake does not wait on a slow cache read', () => {
  it('W1 a 1,000 ms cache read holds the lake load for HYDRATE_WAIT_MS at most', async () => {
    const w = await boot({ idbMs: 1000 })
    w.pf.prepareForDisplay('COLD', '5')
    await vi.advanceTimersByTimeAsync(w.HYDRATE_WAIT_MS + 30)
    const lake = w.log.find((e) => e[0] === 'lake')
    expect(lake).toBeTruthy()
    expect(lake[1]).toBeLessThanOrEqual(w.HYDRATE_WAIT_MS + 5)
    expect(w.log.find((e) => e[0] === 'idb')).toBeUndefined()            // the read is still out
    expect(w.store.peek(w.k('COLD', '5')).bars.length).toBeGreaterThan(0) // the lake's history is held
    await vi.advanceTimersByTimeAsync(1200)
    await w.server.drain()
  })

  it('W2 a cache read that answers within the bound still goes first', async () => {
    const w = await boot({ idbMs: 40 })
    w.pf.prepareForDisplay('COLD', '5')
    await vi.advanceTimersByTimeAsync(w.HYDRATE_WAIT_MS + 30)
    const order = w.log.map((e) => e[0])
    expect(order.indexOf('idb')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('idb')).toBeLessThan(order.indexOf('lake'))
    await w.server.drain()
  })
})
