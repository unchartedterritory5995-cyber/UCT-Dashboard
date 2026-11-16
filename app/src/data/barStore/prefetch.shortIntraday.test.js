// #1314 ported to the BarStore facade (data/barStore/prefetch.js): a stored intraday series shorter
// than half the chart's first-paint window is NOT warm. The warmers ask the full window for it,
// once per key: after an answer, a series still that short is all the server holds, and the rule
// stands down for 6 h. Same server, same scenarios as utils/prefetchBars.shortIntraday.test.js, and
// the legacy warmer run side by side where the two must agree.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN } from './testing/fakeBarsServer'
import { firstPaintBarsFor } from '../../utils/barsBackfill'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 10:02:20 ET, mid-session
const WINDOW = firstPaintBarsFor('5', false)
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW); localStorage.setItem('barspack.version', 'test') })
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

async function boot() {
  vi.resetModules()
  const server = installFakeBarsServer()
  const legacy = await import('../../utils/prefetchBars')
  const { createBarStore } = await import('./index')
  const { createPrefetch, SHORT_FULL_TTL_MS } = await import('./prefetch')
  const idb = await import('../../utils/barsIDB')
  const store = createBarStore({ stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn() })
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, legacy, store, pf, idb, SHORT_FULL_TTL_MS }
}
const tick = (ms) => vi.advanceTimersByTimeAsync(ms)
const drain = (w) => w.server.drain({ advance: () => tick(1500) })
/** `n` 5m rows ending at the bar before now (a CURRENT store) */
function rows(n) {
  const last = Math.floor(NOW / 1000 / 300) * 300 - 300
  return Array.from({ length: n }, (_, i) => ({ t: last - 300 * (n - 1 - i), o: 10, h: 11, l: 9, c: 10.5, v: 100 }))
}
const barsAsked = (calls) => calls.map((c) => Number((c.url.match(/[?&]bars=(\d+)/) || [])[1] || 0))

async function both(scenario) {
  const out = {}
  for (const side of ['legacy', 'facade']) {
    fakeDb._clear()
    vi.setSystemTime(NOW)
    const w = await boot()
    out[side] = await scenario(side === 'legacy' ? w.legacy : w.pf, w)
  }
  return out
}

describe('the BarStore facade warms a short stored intraday series to the full window (#1314)', () => {
  it('has the window it claims to test against', () => {
    expect(WINDOW).toBeGreaterThan(100)
  })

  it('a short CURRENT store is fetched with the full window, as the legacy warmer does', async () => {
    const r = await both(async (api, w) => {
      await w.idb.idbPutMonotonic('SHORT', '5', rows(20))
      api.prefetchBarsToIDB(['SHORT'], '5')
      await drain(w)
      return { syms: w.server.calls.map((c) => c.q.sym), full: barsAsked(w.server.calls).every((n) => n === WINDOW) }
    })
    expect(r.facade).toEqual(r.legacy)
    expect(r.facade).toEqual({ syms: ['SHORT'], full: true })
  })

  it('CONTROL: a deep current store is still skipped', async () => {
    const r = await both(async (api, w) => {
      await w.idb.idbPutMonotonic('DEEP', '5', rows(Math.ceil(WINDOW / 2) + 5))
      api.prefetchBarsToIDB(['DEEP'], '5')
      await drain(w)
      return w.server.calls.length
    })
    expect(r.facade).toBe(0)
    expect(r.legacy).toBe(0)
  })

  it('the line is half the window: one bar under it is short, at it is not', async () => {
    for (const [n, asks] of [[Math.ceil(WINDOW / 2) - 1, 1], [Math.ceil(WINDOW / 2), 0]]) {
      fakeDb._clear()
      const w = await boot()
      await w.idb.idbPutMonotonic('EDGE', '5', rows(n))
      w.pf.prefetchBarsToIDB(['EDGE'], '5')
      await drain(w)
      expect(w.server.calls.length, `${n} bars`).toBe(asks)
    }
  })

  it('CONTROL: intraday only, a short weekly store is left alone', async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('WK', 'W', [{ t: '2026-11-06', o: 10, h: 11, l: 9, c: 10.5, v: 1 }, { t: '2026-11-13', o: 10, h: 11, l: 9, c: 10.5, v: 1 }])
    w.pf.prefetchBarsToIDB(['WK'], 'W')
    await drain(w)
    expect(w.server.calls.filter((c) => c.q.tf === 'W')).toEqual([])          // current, so warm: no request at all
  })

  it('once per key: the answer was still short, so the next warm asks nothing; another symbol still asks', async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('ONCE', '5', rows(20))
    w.pf.prefetchBarsToIDB(['ONCE'], '5')
    await drain(w)
    expect(w.server.calls.length).toBe(1)
    w.pf.prefetchBarsToIDB(['ONCE'], '5')
    w.pf.prefetchBar('ONCE', '5')
    await drain(w)
    expect(w.server.calls.length).toBe(1)
    await w.idb.idbPutMonotonic('OTHER', '5', rows(20))
    w.pf.prefetchBarsToIDB(['OTHER'], '5')
    await drain(w)
    expect(w.server.calls.map((c) => c.q.sym)).toEqual(['ONCE', 'OTHER'])
  })

  it('an answer from the urgent rows-ahead warm counts for the list warm', async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('URG', '5', rows(20))
    w.pf.prefetchBars(['URG'], '5', { urgent: true })
    await drain(w)
    expect(w.server.calls.length).toBe(1)
    expect(barsAsked(w.server.calls)).toEqual([WINDOW])
    w.pf.prefetchBarsToIDB(['URG'], '5')
    await drain(w)
    expect(w.server.calls.length).toBe(1)
  })

  it('after 6 h the full window is asked again', async () => {
    const w = await boot()
    await w.idb.idbPutMonotonic('SIX', '5', rows(20))
    w.pf.prefetchBarsToIDB(['SIX'], '5')
    await drain(w)
    expect(w.server.calls.length).toBe(1)
    vi.setSystemTime(NOW + w.SHORT_FULL_TTL_MS - 60_000)
    w.pf.prefetchBarsToIDB(['SIX'], '5')
    await drain(w)
    expect(w.server.calls.length).toBe(1)
    vi.setSystemTime(NOW + w.SHORT_FULL_TTL_MS + 60_000)
    w.pf.prefetchBarsToIDB(['SIX'], '5')
    await drain(w)
    expect(w.server.calls.length).toBe(2)
    expect(barsAsked(w.server.calls).at(-1)).toBe(WINDOW)
  })
})
