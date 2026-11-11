import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

// ── W-D (2026-11-10): intraday LOAD correctness for a scanning member ──────────
//
// Rules proven here, on the real component:
//   1. The tail request starts on the FIRST render — it does not wait for IndexedDB
//      (the old gate held it until the IDB effect landed, up to 4 s on a busy browser).
//   2. A NOT-CURRENT mem entry is never a frame (it painted a 10:00 tail at 13:17 as
//      the current chart), yet it seeds `since=` so the repair is one small request.
//   3. The repaired delta lands as ONE complete frame: no stale frame, no blank frame
//      between, never a delta-only (short) frame.
//   4. A tail merge does not change the SWR key → no extra request per new bar.
//   5. A timeframe switch aborts the old timeframe's in-flight fetch.

const draws = vi.hoisted(() => ({ list: [] }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const series = {
    setData: (d) => {
      if (Array.isArray(d) && (d.length === 0 || d[0]?.open != null)) {
        draws.list.push({ n: d.length, lastT: d.length ? d[d.length - 1].time : null })
      }
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
const idbh = vi.hoisted(() => ({ delay: 2000, store: new Map() }))
vi.mock('../utils/barsIDB', async (orig) => {
  const real = await orig()
  return { ...real,
    idbGet: async (sym, tf) => {
      await new Promise(r => setTimeout(r, idbh.delay))
      return idbh.store.get(`${sym}_${tf}`) ?? null
    },
    idbPut: async () => {},
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

// ── W-J (2026-11-10): an OFF-GRID intraday row is never its own candle ─────────
// Prod served rows stamped at a trade time (SPY 5m 16:35:50 beside 16:35:00 — Yahoo's
// separate live row). The chart must fold it into its bucket, not draw an extra candle
// between two real ones — whatever cache (IDB/mem) or older server handed it over.

// Tue 2026-09-22 13:17 ET (EDT = UTC-4) — mid-session.
const clock = pinWallClock('2026-09-22T17:17:00Z')
afterAll(() => clock.restore())

const { default: StockChart } = await import('./StockChart')
const { memClear } = await import('../utils/barsMemCache')

const et = (h, m, s = 0) => Math.floor(Date.UTC(2026, 8, 22, h + 4, m, s) / 1000)
const rth5 = () => {
  const out = []
  for (let t = et(9, 30) - 86400; t <= et(15, 55) - 86400; t += 300) out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
  for (let t = et(9, 30); t <= et(13, 10); t += 300) out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
  return out
}
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

beforeEach(() => {
  cleanup(); memClear(); idbh.store.clear(); idbh.delay = 0
  draws.list.length = 0
  try { localStorage.setItem('barspack.version', '2026-09-21') } catch { /* */ }
})

describe('off-grid intraday bar', () => {
  it('a trade-time stamped row beside its bucket row draws NO extra candle', async () => {
    const clean = rth5()
    const withStray = [...clean]
    const i = withStray.findIndex(b => b.t === et(12, 0))
    withStray.splice(i + 1, 0, { t: et(12, 0, 50), o: 10, h: 12, l: 9, c: 10.8, v: 7 })
    vi.stubGlobal('fetch', vi.fn((url) => {
      const u = String(url)
      if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      const body = { ticker: 'OFFGRID', tf: '5', bars: withStray }
      return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, json: async () => body }), 20))
    }))
    render(<StockChart sym="OFFGRID" tf="5" backgroundWarm={false} />)
    await wait(600)
    const nonEmpty = draws.list.filter(d => d.n > 0)
    expect(nonEmpty.length).toBeGreaterThan(0)
    for (const d of nonEmpty) expect(d.n).toBeLessThanOrEqual(clean.length)
    expect(nonEmpty[nonEmpty.length - 1].n).toBe(clean.length)
  })
})
