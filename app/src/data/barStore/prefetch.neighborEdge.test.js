// ⭐⭐ (2026-11-28, zero-network plan 1.7) A LIST'S NEIGHBOUR ROWS FROM THE DEVICE AND THE EDGE, NEVER THE ORIGIN.
// The scan lists warmed the rows around the selection with a background `&warm=1` /api/bars per row per press (an origin
// ask the edge's tail cache cannot share: ~2/s per scanning member, ~200/s at 500). With `edge: true` each row is read from
// the device, its deep sealed history asked from the edge (D/W/M) or its lake pieces primed (intraday), and nothing goes
// to /api/bars; the next rows keep their urgent tail (the chart's own URL, shared at the edge), and the press asks the rest.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { installFakeBarsServer, OPEN, HISTORY_DAYS } from './testing/fakeBarsServer'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const NOW = (OPEN + 32 * 60 + 20) * 1000          // Tue 2026-11-10 10:02:20 ET: D d = Mon 11-09, W d = Fri 11-06, M d = 10-01
let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  fakeDb._clear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.setItem('barspack.version', 'test')   // the daily pack is held: uncached text used to read as a prefix
  localStorage.removeItem('uct.barsHistory.enabled')
  localStorage.setItem('uct.barsHistory.bucket', '5')
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem('barspack.version'); localStorage.removeItem('uct.barsHistory.bucket'); localStorage.removeItem('uct.tickerUniverse')
})

const UNIVERSE = ['AAA', 'AAPL', 'AM', 'AMZN', 'COLD', 'CRBG', 'CRM', 'CRWD', 'GOOG', 'GOOGL', 'NVDA', 'WKLY']

async function boot({ universe = UNIVERSE, lake = () => false } = {}) {
  vi.resetModules()
  const server = installFakeBarsServer()
  const tu = await import('../../lib/tickerUniverse')
  tu.__resetTickerUniverseForTests()
  if (universe) {
    await tu.ensureTickerUniverse({ fetchImpl: async () => ({ ok: true, json: async () => ({ v: 't1', symbols: universe }) }) })
  }
  const { createBarStore } = await import('./index')
  const { createPrefetch, DEEP_JOIN_WAIT_MS } = await import('./prefetch')
  const { EDGE_TAIL_BARS } = await import('./network')
  const { keyOf } = await import('./types')
  const store = createBarStore({
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(),
    isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  store.lakeHas = (sym) => Promise.resolve(lake(sym))
  const pf = createPrefetch({ store, tickerMeta: () => {} })
  return { server, store, pf, tu, k: (sym, tf) => keyOf({ sym, tf }), DEEP_JOIN_WAIT_MS, EDGE_TAIL_BARS }
}
const settle = async (w) => { await w.server.flush(60); await vi.advanceTimersByTimeAsync(1); await w.server.flush(60) }
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10)
const hist = (w) => w.server.calls.filter((c) => c.q.history)
const what = (c) => (c.q.history ? `${c.q.sym} history ${c.q.tf} d=${c.q.d}` : `${c.q.sym} tail ${c.q.tf} bars=${c.q.bars}`)
const COVER = 2000   // a zoomed-out daily view (paintLog viewNeed): the chart's own cover

const origin = (w) => w.server.calls.filter((c) => !c.q.history)
const turns = async (w, n = 4) => { for (let i = 0; i < n; i++) await settle(w) }
const ROWS = ['AAA', 'AAPL', 'AMZN', 'COLD', 'CRBG', 'NVDA']

describe('a list\'s neighbour rows come from the device and the edge, never the origin (edge: true)', () => {
  it('D rows: each its edge history, once; no /api/bars at all', async () => {
    const w = await boot()
    w.pf.prefetchBarsToIDB(ROWS, 'D', { priority: true, edge: true })
    await turns(w)
    await w.server.drain()
    expect(w.server.calls.map(what).sort()).toEqual(ROWS.map((s) => `${s} history D d=2026-11-09`))
    expect(origin(w)).toEqual([])
  })

  it('the flip onto a warmed row asks only its short tail: the deep rows came from the edge before the key', async () => {
    const w = await boot()
    w.pf.prefetchBarsToIDB(['CRBG'], 'D', { priority: true, edge: true })
    await w.server.drain()
    const press = w.pf.prepareDailyForDisplay('CRBG', 'D', { cover: COVER })
    await w.server.drain(); await press
    expect(w.server.calls.map(what).sort()).toEqual(['CRBG history D d=2026-11-09', `CRBG tail D bars=${w.EDGE_TAIL_BARS}`])
    expect(day(w.store.peek(w.k('CRBG', 'D')).bars[0].t)).toBe(HISTORY_DAYS[0])
  })

  it('a press after press: the same rows warmed again send nothing new (one history per key)', async () => {
    const w = await boot()
    w.pf.prefetchBarsToIDB(ROWS, 'D', { priority: true, edge: true })
    await w.server.drain()
    const n = w.server.calls.length
    w.pf.prefetchBarsToIDB(ROWS.slice(1), 'D', { priority: true, edge: true })
    await w.server.drain()
    expect(w.server.calls.length).toBe(n)
  })

  it('intraday rows: the lake is primed (the edge); no /api/bars', async () => {
    const w = await boot()
    const primed = []
    w.store.primeLake = (k) => { primed.push(k) }
    w.pf.prefetchBarsToIDB(['CRM', 'CRWD'], '5', { priority: true, edge: true })
    await turns(w)
    expect(primed.sort()).toEqual([w.k('CRM', '5'), w.k('CRWD', '5')])
    await w.server.drain()
    expect(origin(w)).toEqual([])
  })

  it('CONTROL: without `edge` the same call is the old background warm (a `&warm=1` /api/bars per row)', async () => {
    const w = await boot()
    w.pf.prefetchBarsToIDB(['CRM', 'CRWD'], '5', { priority: true })
    for (let i = 0; i < 20 && origin(w).length < 2; i++) await settle(w)
    expect(origin(w).map((c) => `${c.q.sym} warm=${c.q.warm}`).sort()).toEqual(['CRM warm=true', 'CRWD warm=true'])
    await w.server.drain()
  })

  it('CONTROL: `immediate` (the switch\'s own ask) still asks the origin, edge or not', async () => {
    const w = await boot()
    w.pf.prefetchBarsToIDB(['CRM'], '5', { priority: true, immediate: true, edge: true })
    for (let i = 0; i < 20 && !origin(w).length; i++) await settle(w)
    expect(origin(w).map((c) => c.q.sym)).toEqual(['CRM'])
    await w.server.drain()
  })
})

// REQUEST COUNT of a scripted member arrowing down a 30-row daily list, 1 s a row, the watchlist's calls (the rows around
// with `edge`, the next two urgent): printed per member and x500 (a measurement for the capacity work, not a cap)
describe('request count of a member scanning a daily list (printed x500)', () => {
  it('the rows around cost the edge, the origin only the next rows\' tails', async () => {
    const w = await boot()
    const list = Array.from({ length: 30 }, (_, i) => `S${String.fromCharCode(65 + (i % 26))}${i}`)
    const t0 = Date.now()
    for (let i = 0; i < 20; i++) {
      const around = [...list.slice(i + 1, i + 7), ...list.slice(Math.max(0, i - 2), i)]
      w.pf.prefetchBarsToIDB(around, 'D', { priority: true, edge: true })
      w.pf.prefetchBars(list.slice(i + 1, i + 3), 'D', { urgent: true })
      await settle(w)
      await w.server.drain()
      await vi.advanceTimersByTimeAsync(1000)
    }
    const secs = (Date.now() - t0) / 1000
    const o = origin(w), e = w.server.calls.filter((c) => c.q.history)
    console.info(`[request-count] neighbour scan, 20 rows in ${secs.toFixed(1)} s: origin ${o.length} (${(o.length / secs).toFixed(2)}/s per member, x500 = ${(o.length / secs * 500).toFixed(0)}/s, all edge-shareable: ${o.every((c) => !c.q.warm)}), edge history ${e.length} (${(e.length / secs).toFixed(2)}/s, x500 = ${(e.length / secs * 500).toFixed(0)}/s)`)
    expect(o.every((c) => !c.q.warm)).toBe(true)                   // no `&warm=1`: every origin ask is the chart's own URL
    expect(new Set(o.map((c) => c.q.sym)).size).toBe(o.length)       // one tail per row reached, never one per press
    expect(new Set(e.map((c) => c.q.sym)).size).toBe(e.length)       // one history per row
  })
})

// (review of #2984) A LIST OPENING (prewarmVisibleList: watchlist, theme tracker, screener) reads its rows from the DEVICE
// only: no `&warm=1` /api/bars for up to 500 rows, and no deep history per row either
describe('a list opening reads its rows from the device only (prewarmVisibleList)', () => {
  const LIST = Array.from({ length: 40 }, (_, i) => `L${String.fromCharCode(65 + (i % 26))}${i}`)
  it('D list: nothing on the wire at all', async () => {
    const w = await boot()
    w.pf.prewarmVisibleList(LIST, { chartTf: 'D' })
    await turns(w, 6)
    await w.server.drain()
    expect(w.server.calls).toEqual([])
  })
  it('intraday list: no /api/bars (the lake tier warm, edgeWarmList, is unchanged)', async () => {
    const w = await boot()
    w.pf.prewarmVisibleList(LIST, { chartTf: '5' })
    await turns(w, 6)
    await w.server.drain()
    expect(origin(w)).toEqual([])
  })
})
