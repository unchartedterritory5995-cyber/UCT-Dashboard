// ⭐ HOW MANY TIMES DOES ONE SYMBOL SWITCH RE-RENDER THE CHART? (2026-11-20)
//
// A member arrows down a watchlist with linked charts (D + 60m). Each switch should cost the chart the renders that
// change what it shows, and no more: every StockChart render runs the whole component (hundreds of hooks, the
// derivation chain, the render plan), so a state that flips during a switch and changes nothing on screen is a full
// render for nothing. A production state probe counted 6-9 renders per switch before both charts painted.
//
// Counted here: StockChart's own renders (render-phase restarts included), from the moment the symbol changes until
// the chart is still, on the bar store (BARSTORE, on in production), the library mocked as the other bar-store mount
// tests mock it (its time scale keeps the view the chart sets). Rows have different lengths, as real symbols do.
//
// MEASURED, master 4fde2d0314: 8 renders per daily switch, 9 per 60m switch (and one more onto a longer row). What
// each was, attributed by a probe that logged every state change between the commits:
//   * the switch itself, and the bars of the new symbol landing in the store (the two a switch needs), and two more
//     this change does not touch (the new key's store subscription read after the commit, and this harness's
//     immediate answers to the chart's per-symbol reads);
//   * `fetchDepth` 12,500 -> 600 at the switch (a render-phase restart) and 600 -> 12,500 900 ms later: a D chart
//     already asks for its full depth (`_deepFirstPaint`), so on the bar store the bump changed no request;
//   * `_heldLoaded` 1,200 -> 0 -> 1,200: the held span read "no rows" between the switch and its bars;
//   * `_answered` (useBarSnapshotBars): the new key's first answer, read only by a TIMEFRAME switch's hold;
//   * `_intradayDeepArmed` (60m): false at the switch, true 250 ms later, for the deep backfill's timer;
//   * `lastBarOff` true -> false onto a longer row: the old view's right edge read against the new last bar
//     before the chart framed it.
// After this change all five cost nothing: 4 renders per switch on both timeframes. The bounds below are the
// measured counts (each mutation of the change adds one or two).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Profiler } from 'react'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

const S = vi.hoisted(() => ({ series: [], subs: new Set(), snap: { prices: {} }, ranges: new Set(), renders: 0, range: null }))
// StockChart calls `useNeighborFrames` exactly once per render (render-phase restarts included): its count IS the
// chart's render count, whatever else re-renders inside the tree
vi.mock('./chart/useNeighborFrames', async (orig) => {
  const real = await orig()
  return { ...real, useNeighborFrames: (o) => { S.renders += 1; return real.useNeighborFrames(o) } }
})
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('../lib/priceStreamManager', () => ({
  subscribe: (_t, cb) => { S.subs.add(cb); return () => S.subs.delete(cb) },
  getSnapshot: () => S.snap,
  getLastResume: () => 0, reconnectNow: () => {}, isConnected: () => false, _resetForTests: () => {},
  MAX_SSE_TICKERS: 50, REBUILD_DEBOUNCE_MS: 400,
}))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const make = (type) => {
    const s = {
      kind: type === real.CandlestickSeries ? 'candle' : type === real.HistogramSeries ? 'volume' : 'other',
      points: [],
      setData: (d) => { s.points = Array.isArray(d) ? d.map((p) => ({ ...p })) : [] },
      update: (p) => {
        const last = s.points[s.points.length - 1]
        if (last && String(last.time) === String(p.time)) s.points[s.points.length - 1] = { ...p }
        else s.points.push({ ...p })
      },
      data: () => s.points,
      applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
      detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      getPane: () => ({ paneIndex: () => 0 }), priceFormatter: () => ({ format: (x) => String(x) }),
      dataByIndex: () => null, barsInLogicalRange: () => null,
      subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
    }
    S.series.push(s)
    return s
  }
  const chart = {
    addSeries: (type) => make(type),
    addCandlestickSeries: () => make(real.CandlestickSeries), addHistogramSeries: () => make(real.HistogramSeries),
    addLineSeries: () => make(null), addAreaSeries: () => make(null), addBarSeries: () => make(null),
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      // the view, as the library keeps it: a logical range the chart sets, read back as set, announced to listeners
      applyOptions: () => {}, fitContent: () => {},
      setVisibleLogicalRange: (r) => { S.range = r ? { from: r.from, to: r.to } : null; for (const h of [...S.ranges]) h(S.range) },
      getVisibleLogicalRange: () => S.range,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: (h) => S.ranges.add(h),
      unsubscribeVisibleLogicalRangeChange: (h) => S.ranges.delete(h), timeToCoordinate: () => 0, coordinateToTime: () => null,
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
vi.mock('../utils/barsIDB', async (orig) => ({ ...(await orig()), idbGet: async () => null, idbPut: async () => {}, idbPutMonotonic: async () => {} }))
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: S.snap.prices, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// Tue 2026-11-10 11:00 ET, mid-session
const clock = pinWallClock('2026-11-10T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
const candle = () => S.series.filter((s) => s.kind === 'candle').at(-1)

const dailyRows = (n, k) => {
  const out = []
  const d = new Date(Date.UTC(2026, 10, 9))
  while (out.length < n) {
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) out.unshift({ t: iso, o: 99 * k, h: 101 * k, l: 98 * k, c: 100 * k, v: 1_000_000 })
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
// 60m: RTH hourly rows (09:30 .. 15:30 ET), Nov 2026 is EST (UTC-5)
const hourlyRows = (days, k) => {
  const out = []
  const d = new Date(Date.UTC(2026, 10, 9))
  let left = days
  while (left > 0) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const open = Math.floor(d.getTime() / 1000) + 14 * 3600 + 1800
      const day = []
      for (let h = 0; h < 7; h++) day.push({ t: open + h * 3600, o: 99 * k, h: 101 * k, l: 98 * k, c: 100 * k, v: 50_000 })
      out.unshift(...day)
      left -= 1
    }
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const SYMS = { AAA: 1, BBB: 1.5, CCC: 2, DDD: 2.5, EEE: 3 }
// rows of different lengths, as real symbols have (different listing dates)
const LEN = { AAA: 1, BBB: 0.6, CCC: 1.3, DDD: 0.8, EEE: 1 }
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const m = /\/api\/bars\/([A-Z]+)/.exec(u)
    if (!m || !SYMS[m[1]]) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    const tf = /[?&]tf=([^&]+)/.exec(u)?.[1] || 'D'
    const rows = tf === 'D' ? dailyRows(Math.round(1200 * LEN[m[1]]), SYMS[m[1]]) : hourlyRows(Math.round(150 * LEN[m[1]]), SYMS[m[1]])
    const body = { ticker: m[1], tf, bars: rows, newest_bar_is_forming: false }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
  }))
}

/**
 * Mount one chart on `tf`, let it settle, then switch it through three symbols and count, per switch, the
 * StockChart renders (render-phase restarts included) and the commits of its tree until it is still.
 */
async function scanSwitches(M, tf) {
  let commits = 0
  const onRender = () => { commits += 1 }
  const view = (sym) => (
    <Profiler id="chart" onRender={onRender}>
      <M.StockChart sym={sym} tf={tf} backgroundWarm alwaysShowLegend />
    </Profiler>
  )
  S.series.length = 0
  const r = render(view('AAA'))
  await wait(2500)
  expect(candle()?.points.length, 'AAA painted').toBeGreaterThan(100)
  const out = []
  for (const sym of ['BBB', 'CCC', 'DDD']) {
    commits = 0
    S.renders = 0
    r.rerender(view(sym))
    await wait(2500)
    // the newest painted candle (a daily chart ends on today's empty slot until a quote lands)
    const painted = (candle()?.points || []).filter((pt) => Number.isFinite(pt.close)).at(-1)?.close
    out.push({ sym, renders: S.renders, commits, painted })
  }
  r.unmount()
  // eslint-disable-next-line no-console
  console.log(`[switch renders] ${tf} ${JSON.stringify(out)}`)
  return out
}

describe('one symbol switch, one chart, on the bar store', () => {
  let M
  beforeAll(async () => {
    stubFetch()
    M = await loadWithBarStore(true, async () => ({ StockChart: (await import('./StockChart')).default }))
  }, 60_000)
  afterAll(() => cleanup())

  it('non-vacuity: the switch is ON in this graph', () => { expect(M.__barStore).toBe(true) })

  it('daily: the chart renders for the switch and for the new bars, and is then still', async () => {
    const out = await scanSwitches(M, 'D')
    for (const s of out) {
      expect(s.painted, `${s.sym} painted`).toBe(100 * SYMS[s.sym])
      expect(s.renders, `${s.sym}: StockChart renders per switch`).toBeLessThanOrEqual(DAILY_MAX_RENDERS)
    }
  }, 60_000)

  it('the latest bar scrolled out of view still shows "Scroll to present day", and scrolling back hides it', async () => {
    S.series.length = 0
    const r = render(<M.StockChart sym="AAA" tf="D" backgroundWarm alwaysShowLegend />)
    await wait(2500)
    const n = candle().points.length
    const scrollTo = (from, to) => act(() => { S.range = { from, to }; for (const h of [...S.ranges]) h(S.range) })
    const shown = () => !!document.querySelector('[aria-label="Scroll to present day"]')
    expect(shown(), 'shown while the latest bar is in view').toBe(false)
    await scrollTo(10, 150)
    await wait(60)
    expect(shown(), 'the latest bar is off screen').toBe(true)
    await scrollTo(n - 150, n + 4)
    await wait(60)
    expect(shown(), 'back at the present').toBe(false)
    r.unmount()
  }, 30_000)

  it('60m: the same', async () => {
    const out = await scanSwitches(M, '60')
    for (const s of out) {
      expect(s.painted, `${s.sym} painted`).toBe(100 * SYMS[s.sym])
      expect(s.renders, `${s.sym}: StockChart renders per switch`).toBeLessThanOrEqual(INTRADAY_MAX_RENDERS)
    }
  }, 60_000)
})

/** The most StockChart renders one switch may cost (measured; see the header). */
const DAILY_MAX_RENDERS = 4
const INTRADAY_MAX_RENDERS = 4
