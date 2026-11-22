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

// Tue 2026-09-22 13:17 ET (EDT = UTC-4) — mid-session.
const clock = pinWallClock('2026-09-22T17:17:00Z')
afterAll(() => clock.restore())

const { default: StockChart } = await import('./StockChart')
const { memPut, memClear } = await import('../utils/barsMemCache')

const et = (h, m) => Math.floor(Date.UTC(2026, 8, 22, h + 4, m) / 1000)
const rth5 = (toH, toM) => {
  const out = []
  // Mon 09-21 full session, then Tue 09-22 from the open to toH:toM.
  for (let t = et(9, 30) - 86400; t <= et(15, 55) - 86400; t += 300) out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
  for (let t = et(9, 30); t <= et(toH, toM); t += 300) out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
  return out
}
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

let reqs
function serve({ latency = 30, hang = false } = {}) {
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    const m = u.match(/\/api\/bars\/([^?]+)\?tf=([^&]+)/)
    const since = (u.match(/[?&]since=(\d+)/) || [])[1]
    const rec = { url: u, at: performance.now(), since: since ? Number(since) : null, aborted: false }
    reqs.push(rec)
    opts?.signal?.addEventListener?.('abort', () => { rec.aborted = true })
    if (hang) return new Promise(() => {})
    const all = rth5(13, 10)
    const body = since
      ? { ticker: decodeURIComponent(m[1]).toUpperCase(), tf: m[2], delta: true, bars: all.filter(b => b.t > Number(since)) }
      : { ticker: decodeURIComponent(m[1]).toUpperCase(), tf: m[2], bars: all }
    return new Promise((res) => setTimeout(() => res({ ok: true, status: 200, json: async () => body }), latency))
  }))
}

beforeEach(() => {
  cleanup(); memClear(); idbh.store.clear(); idbh.delay = 2000
  draws.list.length = 0; reqs = []
  try { localStorage.setItem('barspack.version', '2026-09-21') } catch { /* */ }
})

describe('intraday load: stale mem, slow IDB', () => {
  it('the tail request starts BEFORE IDB answers, seeded with since=<mem tail - 1>', async () => {
    memPut('MEMSTALE', '5', rth5(10, 0))
    serve()
    render(<StockChart sym="MEMSTALE" tf="5" backgroundWarm={false} />)
    await wait(300)
    const bars = reqs.filter(r => r.url.includes('/api/bars/MEMSTALE'))
    expect(bars.length).toBe(1)
    expect(bars[0].since).toBe(et(10, 0) - 1)
  })

  it('a BEHIND (sound) mem tail paints AT ONCE as context minus its forming candle, then ONE complete frame — no blank between', async () => {
    const base = rth5(10, 0)
    memPut('MEMSTALE2', '5', base)
    serve({ latency: 80 })
    render(<StockChart sym="MEMSTALE2" tf="5" backgroundWarm={false} />)
    await wait(40)
    // Before any network answer: the history is on screen, without the last (forming) candle.
    expect(draws.list.some(d => d.n === base.length - 1)).toBe(true)
    await wait(600)
    const nonEmpty = draws.list.filter(d => d.n > 0)
    const full = rth5(13, 10).length
    // Only two shapes are ever drawn: the context and the complete current series.
    for (const d of nonEmpty) expect([base.length - 1, full]).toContain(d.n)
    expect(nonEmpty[nonEmpty.length - 1].n).toBe(full)
    // and no empty frame after the first real one
    const first = draws.list.findIndex(d => d.n > 0)
    expect(draws.list.slice(first).some(d => d.n === 0)).toBe(false)
  })

  it('the context frame is never presented as current (frame log: current=false ⇒ settled=false)', async () => {
    localStorage.setItem('uct.chartTiming', '1'); window.__uctFrameLog = []
    try {
      memPut('MEMCTX', '5', rth5(10, 0))
      serve({ latency: 80 })
      render(<StockChart sym="MEMCTX" tf="5" backgroundWarm={false} />)
      await wait(600)
      const rows = (window.__uctFrameLog || []).filter(r => r.sym === 'MEMCTX')
      expect(rows.some(r => r.context)).toBe(true)
      expect(rows.filter(r => !r.current && r.settled)).toEqual([])
      expect(rows[rows.length - 1].current).toBe(true)
    } finally { localStorage.removeItem('uct.chartTiming') }
  })

  it('a GAPPED mem tail is never drawn, even when the request fails', async () => {
    // Friday-ish: two sessions old → gapped
    memPut('MEMGAP', '5', rth5(15, 55).filter(b => b.t < et(9, 30)).map(b => ({ ...b, t: b.t - 86400 })))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), clone() { return this } })))
    render(<StockChart sym="MEMGAP" tf="5" backgroundWarm={false} />)
    await wait(400)
    expect(draws.list.filter(d => d.n > 0)).toEqual([])
  })

  it('a CURRENT mem tail paints at once, before any network answer', async () => {
    memPut('MEMOK', '5', rth5(13, 10))
    serve({ hang: true })
    render(<StockChart sym="MEMOK" tf="5" backgroundWarm={false} />)
    await wait(100)
    expect(draws.list.some(d => d.n === rth5(13, 10).length)).toBe(true)
  })
})

describe('one request per poll', () => {
  it('a merge that advances the tail does NOT trigger another request (since is not in the key)', async () => {
    memPut('KEYSTABLE', '5', rth5(12, 0))
    idbh.delay = 5
    serve()
    render(<StockChart sym="KEYSTABLE" tf="5" backgroundWarm={false} />)
    await wait(1200)
    // Only the primary tail key (the dwell deep-backfill is a separate one-shot bars=3000 pull).
    const n = reqs.filter(r => r.url.includes('/api/bars/KEYSTABLE') && !r.url.includes('bars=3000') && !r.url.includes('&to=')).length
    // The first answer advances the tail 12:00 → 13:10. Before: the key changed to the
    // new since= and SWR fired again immediately.
    expect(n).toBe(1)
  })
})

describe('timeframe switch', () => {
  it('aborts the previous timeframe\'s in-flight fetch', async () => {
    serve({ hang: true })
    const { rerender } = render(<StockChart sym="TFSW" tf="5" backgroundWarm={false} />)
    await wait(200)
    rerender(<StockChart sym="TFSW" tf="15" backgroundWarm={false} />)
    await wait(200)
    const five = reqs.filter(r => r.url.includes('/api/bars/TFSW?tf=5'))
    expect(five.length).toBeGreaterThan(0)
    expect(five.every(r => r.aborted)).toBe(true)
  })
})

describe('per-load identity', () => {
  it('two charts on the SAME sym+tf each run their own tail request (module-wide load number)', async () => {
    memPut('TWIN', '5', rth5(12, 0))
    serve()
    render(<><StockChart sym="TWIN" tf="5" backgroundWarm={false} /><StockChart sym="TWIN" tf="5" backgroundWarm={false} /></>)
    await wait(400)
    const tails = reqs.filter(r => r.url.includes('/api/bars/TWIN') && !r.url.includes('bars=3000') && !r.url.includes('&to='))
    expect(tails.length).toBe(2)
  })

  it('a request still waiting on IDB when the member scans on never reaches the network', async () => {
    // no mem → the fetcher races the (slow) IDB read for _IDB_TAIL_WAIT_MS
    serve({ hang: true })
    const { rerender } = render(<StockChart sym="GONE" tf="5" backgroundWarm={false} />)
    await wait(30)
    rerender(<StockChart sym="NEXT" tf="5" backgroundWarm={false} />)
    await wait(400)
    expect(reqs.filter(r => r.url.includes('/api/bars/GONE'))).toEqual([])
    expect(reqs.filter(r => r.url.includes('/api/bars/NEXT')).length).toBeGreaterThan(0)
  })
})
