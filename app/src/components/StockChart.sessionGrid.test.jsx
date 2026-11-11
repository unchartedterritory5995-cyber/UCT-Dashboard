import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

// ── W-G (2026-11-10): the chart's SESSION is a first-class /api/bars input ─────
//
// Proven on the real component:
//   1. Every primary intraday request carries `&session=rth|eth` (the server judges
//      the tail against the chart's own session — review #1051 F2).
//   2. 60m with extended hours on fetches `session=eth` (TradingView's clock-hour grid)
//      and caches it under its OWN key ('60e'); RTH keeps the session grid under '60'.
//   3. Switching session on an OPEN 60m chart never draws a mixed-grid series: every
//      frame is wholly the session grid (09:30, 10:30 …) or wholly the clock grid.
//   4. Non-60 timeframes share ONE cache key across sessions (no halved hit rate).

const draws = vi.hoisted(() => ({ list: [] }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const series = {
    setData: (d) => {
      if (Array.isArray(d) && (d.length === 0 || d[0]?.open != null)) {
        draws.list.push({ n: d.length, times: d.map((x) => x.time) })
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
const idbh = vi.hoisted(() => ({ store: new Map(), gets: [] }))
vi.mock('../utils/barsIDB', async (orig) => {
  const real = await orig()
  return { ...real,
    idbGet: async (sym, tf) => { idbh.gets.push(`${sym}_${tf}`); return idbh.store.get(`${sym}_${tf}`) ?? null },
    idbPut: async (sym, tf, bars) => { idbh.store.set(`${sym}_${tf}`, { bars, lastT: bars[bars.length - 1]?.t }) },
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

// Tue 2026-11-10 13:17 ET (EST = UTC-5) — mid-session.
const clock = pinWallClock('2026-11-10T18:17:00Z')
afterAll(() => clock.restore())

const { default: StockChart } = await import('./StockChart')
const { memClear, memPeek } = await import('../utils/barsMemCache')
const { toChartTime } = await import('./chart/barTime')

const et = (d, h, m) => Math.floor(Date.UTC(2026, 10, d, h + 5, m) / 1000)
const bar = (t) => ({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
// Session (RTH) grid, Mon 11-09 + Tue 11-10 through the 12:30 bucket.
function sessionGrid() {
  const out = []
  for (const d of [9, 10]) {
    for (let h = 4; h <= 8; h++) out.push(bar(et(d, h, 0)))
    out.push(bar(et(d, 9, 0)))
    for (const [h, m] of [[9, 30], [10, 30], [11, 30], [12, 30], [13, 30], [14, 30], [15, 30]]) {
      if (d === 10 && h > 12) break
      out.push(bar(et(d, h, m)))
    }
    if (d === 9) for (let h = 16; h <= 19; h++) out.push(bar(et(d, h, 0)))
  }
  return out
}
// Clock (ETH) grid, same span through the 13:00 bucket.
function clockGrid() {
  const out = []
  for (const d of [9, 10]) {
    for (let h = 4; h <= 19; h++) {
      if (d === 10 && h > 13) break
      out.push(bar(et(d, h, 0)))
    }
  }
  return out
}
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

let reqs
function serve() {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    const m = u.match(/\/api\/bars\/([^?]+)\?tf=([^&]+)/)
    const tf = m[2]
    const session = (u.match(/[?&]session=(\w+)/) || [])[1] || null
    const since = (u.match(/[?&]since=(\d+)/) || [])[1]
    reqs.push({ url: u, tf, session, since: since ? Number(since) : null })
    const eth60 = tf === '60' && session === 'eth'
    const all = tf === '60' ? (eth60 ? clockGrid() : sessionGrid())
      : Array.from({ length: 50 }, (_, i) => bar(et(10, 9, 30) + 300 * i))
    const rows = since ? all.filter((b) => b.t > Number(since)) : all
    const body = { ticker: decodeURIComponent(m[1]).toUpperCase(), tf, bars: rows,
      ...(since ? { delta: true } : {}), ...(eth60 ? { session: 'eth' } : {}), tail_status: 'current' }
    return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, json: async () => body }), 20))
  }))
}

// Wall-clock minute of a chart time (chart time = the ET wall clock as UTC seconds).
const minuteOf = (ct) => Math.floor((ct % 3600) / 60)
const hourOf = (ct) => Math.floor((ct % 86400) / 3600)
function gridOf(times) {
  const half = times.some((t) => minuteOf(t) === 30)
  // :00 bars inside 10:00-15:00 exist ONLY on the clock grid.
  const clockOnly = times.some((t) => minuteOf(t) === 0 && hourOf(t) >= 10 && hourOf(t) <= 15)
  if (half && clockOnly) return 'MIXED'
  return half ? 'session' : clockOnly ? 'clock' : 'either'
}

beforeEach(() => {
  cleanup(); memClear(); idbh.store.clear(); idbh.gets.length = 0
  draws.list.length = 0; reqs = []
  try { localStorage.setItem('barspack.version', '2026-11-09') } catch { /* */ }
})

describe('session is part of the request', () => {
  it('RTH 5m asks session=rth, extended 5m asks session=eth — and both use ONE cache key', async () => {
    serve()
    const { rerender } = render(<StockChart sym="SESS5" tf="5" forceExtendedHours={false} backgroundWarm={false} />)
    await wait(300)
    rerender(<StockChart sym="SESS5" tf="5" forceExtendedHours={true} backgroundWarm={false} />)
    await wait(300)
    const five = reqs.filter((r) => r.url.includes('/api/bars/SESS5') && r.tf === '5')
    expect(five.some((r) => r.session === 'rth')).toBe(true)
    expect(five.some((r) => r.session === 'eth')).toBe(true)
    expect(five.every((r) => r.session)).toBe(true)
    expect(idbh.gets.filter((k) => k.startsWith('SESS5_')).every((k) => k === 'SESS5_5')).toBe(true)
  })
})

describe('60m: extended hours is the clock grid', () => {
  it('extended 60m fetches session=eth and caches it under 60e; every frame is on the clock grid', async () => {
    serve()
    render(<StockChart sym="ETH60" tf="60" forceExtendedHours={true} backgroundWarm={false} />)
    await wait(400)
    const r60 = reqs.filter((r) => r.url.includes('/api/bars/ETH60') && r.tf === '60')
    expect(r60.length).toBeGreaterThan(0)
    expect(r60.every((r) => r.session === 'eth')).toBe(true)
    expect(idbh.gets).toContain('ETH60_60e')
    expect(memPeek('ETH60', '60e')?.length).toBe(clockGrid().length)
    expect(memPeek('ETH60', '60')).toBeNull()
    const frames = draws.list.filter((d) => d.n > 0)
    expect(frames.length).toBeGreaterThan(0)
    for (const f of frames) expect(gridOf(f.times)).not.toBe('session')
    expect(frames[frames.length - 1].times).toContain(toChartTime(et(10, 10, 0)))
  })

  it('switching session on an OPEN 60m chart never draws a mixed-grid series, either way', async () => {
    serve()
    const { rerender } = render(<StockChart sym="FLIP60" tf="60" forceExtendedHours={false} backgroundWarm={false} />)
    await wait(400)
    const afterRth = draws.list.length
    expect(draws.list.filter((d) => d.n > 0).some((d) => gridOf(d.times) === 'session')).toBe(true)
    expect(reqs.filter((r) => r.tf === '60').every((r) => r.session === 'rth')).toBe(true)

    rerender(<StockChart sym="FLIP60" tf="60" forceExtendedHours={true} backgroundWarm={false} />)
    await wait(400)
    const ethFrames = draws.list.slice(afterRth).filter((d) => d.n > 0)
    expect(reqs.some((r) => r.tf === '60' && r.session === 'eth')).toBe(true)
    expect(ethFrames[ethFrames.length - 1] && gridOf(ethFrames[ethFrames.length - 1].times)).toBe('clock')

    const afterEth = draws.list.length
    rerender(<StockChart sym="FLIP60" tf="60" forceExtendedHours={false} backgroundWarm={false} />)
    await wait(400)
    const backFrames = draws.list.slice(afterEth).filter((d) => d.n > 0)
    expect(backFrames.length).toBeGreaterThan(0)
    expect(gridOf(backFrames[backFrames.length - 1].times)).toBe('session')

    for (const f of draws.list) expect(gridOf(f.times)).not.toBe('MIXED')
    // each grid lives under its own key — neither was overwritten by the other
    expect(gridOf(memPeek('FLIP60', '60').map((b) => toChartTime(b.t)))).toBe('session')
    expect(gridOf(memPeek('FLIP60', '60e').map((b) => toChartTime(b.t)))).toBe('clock')
  })

  it('a 60m answer WITHOUT session=eth (an older server) is never stored under the 60e key', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const u = String(url)
      if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      reqs.push({ url: u })
      // ignores `session`, answers the stored session grid with no `session` field
      return new Promise((res) => setTimeout(() => res({ ok: true, status: 200,
        json: async () => ({ ticker: 'OLDSRV', tf: '60', bars: sessionGrid() }) }), 20))
    }))
    render(<StockChart sym="OLDSRV" tf="60" forceExtendedHours={true} backgroundWarm={false} />)
    await wait(400)
    expect(memPeek('OLDSRV', '60e')).toBeNull()
    expect(idbh.store.has('OLDSRV_60e')).toBe(false)
  })
})
