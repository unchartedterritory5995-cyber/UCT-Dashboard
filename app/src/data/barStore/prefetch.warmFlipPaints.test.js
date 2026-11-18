// A list warm counts a row as warm only if the FLIP will paint it (2026-11-17).
// Production 2026-11-16 (flip proof, 60m): rows whose LOCAL copy the store's status called
// `context` were skipped by the warm, then refused by the handoff's paint rule (`_localPaints`,
// the view's `isCacheCurrentForView`), so the chart waited on its own request: FNGD / SSG first
// candles 118 / 126 ms against ~35 ms for rows the warm had fetched. Now such a row is fetched
// by the warm, and its server answer is what the flip paints at once.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, intradayRows, OPEN } from './testing/fakeBarsServer'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))
const paint = { verdict: true }
vi.mock('../../utils/marketSession', async (orig) => {
  const real = await orig()
  return { ...real, isCacheCurrentForView: () => paint.verdict }
})

const NOW = (OPEN + 32 * 60 + 20) * 1000
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
// A returning member: the daily pack is ingested, so background warms are not held
// (utils/prefetchBars `_holdBackgroundWarm`).
beforeEach(() => {
  fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW); paint.verdict = true
  localStorage.setItem('barspack.version', 'test')
})
afterEach(() => { localStorage.removeItem('barspack.version'); vi.useRealTimers() })

async function boot() {
  const server = installFakeBarsServer()
  const { createBarStore } = await import('./index')
  const { createPrefetch } = await import('./prefetch')
  const idb = await import('../../utils/barsIDB')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  return { server, store, idb, pf: createPrefetch({ store, tickerMeta: () => {} }) }
}

// A DEEP local copy (not a "short" series, which the warm re-asks for depth regardless),
// current through the newest closed bucket by the data rule.
const deepRows = (now) => intradayRows(5, now - 300, { from: OPEN - 20 * 86400 })

async function warmOnce(sym, tf, rows, verdict) {
  fakeDb._clear()
  memClear()                        // each run starts from the same caches
  const w = await boot()
  await w.idb.idbPutMonotonic(sym, tf, rows)
  paint.verdict = verdict
  w.pf.prefetchBarsToIDB([sym], tf, { priority: true })
  await vi.advanceTimersByTimeAsync(50)
  return w
}

describe('a warm is warm only if the flip will paint it', () => {
  it('a local copy the view would refuse is fetched by the warm', async () => {
    const now = Math.floor(NOW / 1000)
    const w = await warmOnce('WRF', '5', deepRows(now), false)
    expect(w.server.calls.length).toBe(1)
    await w.server.drain()
    expect(w.pf.peekDisplayable('WRF', '5')).toBe(true)                  // the flip now paints it
  })

  it('CONTROL: the same copy, which the view paints, costs no request', async () => {
    const now = Math.floor(NOW / 1000)
    const w = await warmOnce('WRP', '5', deepRows(now), true)
    expect(w.server.calls.length).toBe(0)
  })

  it('a held daily copy costs no request (the intraday paint rule never judges D/W/M)', async () => {
    // `_localPaints` answers false for every non-intraday tf, so a check that forgot the
    // intraday guard would re-ask every held daily copy on every list warm.
    const rows = [
      { t: '2026-11-06', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: '2026-11-09', o: 1.5, h: 2, l: 1, c: 1.8, v: 10 },
      { t: '2026-11-10', o: 1.8, h: 2.1, l: 1.7, c: 2.0, v: 5 },   // today's, so the set is current
    ]
    const w = await warmOnce('WRD', 'D', rows, true)
    expect(w.server.calls.length).toBe(0)
  })
})
