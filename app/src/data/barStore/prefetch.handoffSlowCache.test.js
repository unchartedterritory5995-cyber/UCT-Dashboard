// The symbol handoff (prepareForDisplay) never holds the chart's request on a slow cache read.
// The IDB read can take 400-900 ms while the list warm writes to the same database; the flip proof
// on the master build (2026-11-16) showed the first flips' visible request leaving +412 / +862 ms
// after the key and first candles at ~1 s, while the legacy path (which waits at most 120 ms for
// IDB) painted in 42 ms median. A read slower than HYDRATE_WAIT_MS no longer delays the request,
// and a local copy that paints still commits if it lands before the server answers.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, intradayRows, OPEN } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))
const paint = { verdict: true }
vi.mock('../../utils/marketSession', async (orig) => {
  const real = await orig()
  return { ...real, isCacheCurrentForView: () => paint.verdict }
})

const NOW = (OPEN + 32 * 60 + 20) * 1000
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

async function boot({ readMs }) {
  const server = installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const { createPrefetch, HYDRATE_WAIT_MS } = await import('./prefetch')
  const idb = await import('../../utils/barsIDB')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  // The cache read takes `readMs` (the IDB busy with the list warm's writes).
  const realHydrate = store.persist.hydrate
  store.persist.hydrate = (key) => new Promise((resolve) => setTimeout(resolve, readMs)).then(() => realHydrate(key))
  return { server, store, idb, HYDRATE_WAIT_MS, pf: createPrefetch({ store, tickerMeta: () => {} }) }
}

describe('the handoff does not wait on a slow cache read', () => {
  it('nothing cached, the read takes 900 ms: the request leaves by HYDRATE_WAIT_MS and the answer commits', async () => {
    const w = await boot({ readMs: 900 })
    const p = w.pf.prepareForDisplay('SLW', '5')
    await vi.advanceTimersByTimeAsync(w.HYDRATE_WAIT_MS + 10)
    expect(w.server.calls.length).toBe(1)                 // asked at ~120 ms, not after the 900 ms read
    await w.server.drain()
    await expect(p).resolves.toBe('current')
  })

  it('a cached copy that paints lands at 300 ms while the server is still answering: it commits', async () => {
    const w = await boot({ readMs: 300 })
    const now = Math.floor(NOW / 1000)
    await w.idb.idbPutMonotonic('LCZ', '5', intradayRows(5, now - 300))
    paint.verdict = true
    let done = null
    w.pf.prepareForDisplay('LCZ', '5').then((r) => { done = r })
    await vi.advanceTimersByTimeAsync(w.HYDRATE_WAIT_MS + 10)
    expect(w.server.calls.length).toBe(1)                 // the request left without waiting
    expect(done).toBe(null)
    await vi.advanceTimersByTimeAsync(300)
    expect(done).toBe('current')                          // the local copy committed before the answer
  })

  it('a fast read keeps the old path: a copy that paints commits with no request at all', async () => {
    const w = await boot({ readMs: 20 })
    const now = Math.floor(NOW / 1000)
    await w.idb.idbPutMonotonic('LCQ', '5', intradayRows(5, now - 300))
    paint.verdict = true
    const p = w.pf.prepareForDisplay('LCQ', '5')
    await vi.advanceTimersByTimeAsync(50)
    await expect(p).resolves.toBe('current')
    expect(w.server.calls.length).toBe(0)
  })
})
