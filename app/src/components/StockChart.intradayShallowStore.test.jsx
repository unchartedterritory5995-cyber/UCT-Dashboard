import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

// ── A short STORED intraday series gets the full window at once (2026-11-15) ─────────
// Measured on production (5-minute charts, S&P 100): 5 of 40 symbols had only 107-151 bars stored
// (the intraday pack seeds about a day and a half). The chart asked only for the bars after them
// (`since=`), so a 200-bar average stayed blank until the deep-history step filled it at +1.06 s.
// Rules, on the real component:
//   1. a stored series shorter than half the window the chart asks for: the first ask is FULL
//      (no `since=`), and the full set is what is drawn;
//   2. CONTROL: a stored series at least half the window: the ask is `since=` as before;
//   3. a short copy held only in MEMORY (no stored series) keeps `since=`: memory can be
//      shallower than what IndexedDB holds, and a full answer must never replace deeper bars;
//   4. the full ask happens once: the chart does not ask for the full window again (the rule
//      itself, `askFullForShortStore`, is tested directly below; a re-ask AFTER a short full
//      answer is not reachable here: the chart's catch-up timing needs more than jsdom gives);
//   5. a first ask the server answers "warming" is retried in full once the store has answered.

const draws = vi.hoisted(() => ({ list: [] }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const series = {
    setData: (d) => {
      if (Array.isArray(d) && (d.length === 0 || d[0]?.open != null)) draws.list.push({ n: d.length })
    },
    update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    getPane: () => ({ paneIndex: () => 0 }), priceFormatter: () => ({ format: (p) => String(p) }),
    dataByIndex: () => null, barsInLogicalRange: () => null,
  }
  const chart = {
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, logicalToCoordinate: () => 0,
      subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
const idbh = vi.hoisted(() => ({ delay: 0, store: new Map() }))
vi.mock('../utils/barsIDB', async (orig) => {
  const real = await orig()
  return { ...real,
    idbGet: async (sym, tf) => {
      await new Promise(r => setTimeout(r, idbh.delay))
      return idbh.store.get(`${sym}_${tf}`) ?? null
    },
    idbPut: async () => {},
    idbGetHistory: async () => null, idbPutHistory: async () => null,
  }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// Tue 2026-09-22 13:17 ET (EDT = UTC-4): mid-session.
const clock = pinWallClock('2026-09-22T17:17:00Z')
afterAll(() => clock.restore())

const { default: StockChart } = await import('./StockChart')
const { memPut, memClear } = await import('../utils/barsMemCache')

const et = (day, h, m) => Math.floor(Date.UTC(2026, 8, day, h + 4, m) / 1000)
/** 5-minute RTH bars: `days` full sessions before Tue 09-22, then Tue from the open to 13:10. */
function rth5(days) {
  const out = []
  const sessions = []
  for (let d = 21; sessions.length < days; d--) {
    const wd = new Date(Date.UTC(2026, 8, d)).getUTCDay()
    if (wd !== 0 && wd !== 6) sessions.unshift(d)
  }
  for (const d of sessions) for (let t = et(d, 9, 30); t <= et(d, 15, 55); t += 300) out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
  for (let t = et(22, 9, 30); t <= et(22, 13, 10); t += 300) out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
  return out
}
const SERVER = rth5(20)                         // the server's history: deeper than any window asked
const SHORT = rth5(1)                           // ~a day and a half, like the intraday pack seeds
const LONG = rth5(12)                           // more than half of any window the chart asks for
const entry = (bars) => ({ bars, lastT: bars[bars.length - 1].t, savedAt: Date.now() })
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

let reqs
/** `history`: what the server holds. `warmFirst`: answer the first ask with a 503 "warming". */
function serve({ history = SERVER, warmFirst = false } = {}) {
  let first = true
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    const m = u.match(/\/api\/bars\/([^?]+)\?tf=([^&]+)/)
    const n = Number((u.match(/[?&]bars=(\d+)/) || [])[1] || 0)
    const since = (u.match(/[?&]since=(\d+)/) || [])[1]
    if (m[2] !== '5' || /[?&]to=/.test(u)) return new Promise(() => {})   // other warms: never answer
    reqs.push({ url: u, sym: decodeURIComponent(m[1]).toUpperCase(), n, since: since ? Number(since) : null })
    if (warmFirst && first) {
      first = false
      const res = { ok: false, status: 503, headers: { get: (h) => (h === 'Retry-After' ? '1' : null) },
        json: async () => ({ error: 'warming' }) }
      res.clone = () => res
      return new Promise((r) => setTimeout(() => r(res), 30))
    }
    const body = since
      ? { ticker: decodeURIComponent(m[1]).toUpperCase(), tf: '5', delta: true, bars: history.filter(b => b.t > Number(since)) }
      : { ticker: decodeURIComponent(m[1]).toUpperCase(), tf: '5', bars: history.slice(-n) }
    return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, json: async () => body }), 30))
  }))
}
const asks = (sym) => reqs.filter((r) => r.sym === sym)
const lastDrawn = () => draws.list.filter((d) => d.n > 0).at(-1)?.n

beforeEach(() => {
  cleanup(); memClear(); idbh.store.clear(); idbh.delay = 0
  draws.list.length = 0; reqs = []
  try { localStorage.setItem('barspack.version', '2026-09-21') } catch { /* */ }
})

describe('a short stored intraday series', { timeout: 30000 }, () => {
  it('gets the FULL window on the first ask, and the full set is drawn', async () => {
    idbh.store.set('SHORTS_5', entry(SHORT))
    serve()
    render(<StockChart sym="SHORTS" tf="5" backgroundWarm={false} />)
    await wait(600)
    const a = asks('SHORTS')
    expect(a.length).toBeGreaterThan(0)
    expect(SHORT.length).toBeLessThan(a[0].n / 2)                     // the case this is about
    expect(a[0].since).toBe(null)
    expect(lastDrawn()).toBe(Math.min(a[0].n, SERVER.length))
  })

  it('also when the store answers inside the race (before the IDB effect lands)', async () => {
    idbh.delay = 40                                                   // under _IDB_TAIL_WAIT_MS: the race reads it
    idbh.store.set('SHORTR_5', entry(SHORT))
    serve()
    render(<StockChart sym="SHORTR" tf="5" backgroundWarm={false} />)
    await wait(600)
    expect(asks('SHORTR')[0].since).toBe(null)
  })

  it('CONTROL: a stored series at least half the window is asked for its tail only, as before', async () => {
    idbh.store.set('LONGS_5', entry(LONG))
    serve()
    render(<StockChart sym="LONGS" tf="5" backgroundWarm={false} />)
    await wait(600)
    const a = asks('LONGS')
    expect(LONG.length).toBeGreaterThanOrEqual(a[0].n / 2)
    expect(a[0].since).toBe(LONG.at(-1).t - 1)
  })

  it('a short copy held only in memory keeps since=: memory is not the store', async () => {
    idbh.delay = 2000                                                 // the store has not answered
    memPut('MEMONLY', '5', SHORT)
    serve()
    render(<StockChart sym="MEMONLY" tf="5" backgroundWarm={false} />)
    await wait(400)
    expect(asks('MEMONLY')[0].since).toBe(SHORT.at(-1).t - 1)
  })

  it('the full ask happens once per load: no second full window', async () => {
    idbh.store.set('ONCE_5', entry(SHORT))
    serve()
    render(<StockChart sym="ONCE" tf="5" backgroundWarm={false} />)
    await wait(1500)
    expect(asks('ONCE').filter((r) => r.since === null)).toHaveLength(1)
  })

  it('a first ask the server answers "warming" is retried in FULL once the store has answered', async () => {
    idbh.store.set('WARM_5', entry(SHORT))
    serve({ warmFirst: true })
    render(<StockChart sym="WARM" tf="5" backgroundWarm={false} />)
    await wait(2500)
    const a = asks('WARM')
    expect(a.length).toBeGreaterThanOrEqual(2)                        // the 503, then the retry
    expect(a[1].since).toBe(null)
    expect(lastDrawn()).toBe(Math.min(a[1].n, SERVER.length))
  })
})

describe('askFullForShortStore', () => {
  it('asks in full only for a short STORED series, once', async () => {
    const { askFullForShortStore } = await import('./chart/useLegacyChartBars')
    const base = { since: 123, storedLen: 100, want: 1152, fullDone: false }
    expect(askFullForShortStore(base)).toBe(true)
    expect(askFullForShortStore({ ...base, fullDone: true })).toBe(false)     // a full answer already landed
    expect(askFullForShortStore({ ...base, storedLen: 576 })).toBe(false)     // half the window is enough
    expect(askFullForShortStore({ ...base, storedLen: 575 })).toBe(true)
    expect(askFullForShortStore({ ...base, storedLen: 0 })).toBe(false)       // not from the store
    expect(askFullForShortStore({ ...base, since: null })).toBe(false)        // already a full ask
  })
})
