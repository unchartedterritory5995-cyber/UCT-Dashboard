// ⭐⭐ (lane C, review of #3033) A TIMEFRAME PRESS FROM A DAILY CHART NEVER EMPTIES THE CHART: the REAL StockChart.
// The production BLANK (cloud rig COV-tf-def press 0, D -> 1m, 2 of 8 presses): a daily chart records no intraday
// on-screen source, so the switch hold never engaged and updateChart's empty arm cleared every series while the 1m key
// held no rows. The hook rail (useBarSnapshotBars.tfSwitchEmpty.test) sets `_shownTfRef` by hand; this one goes through
// the component, so deleting StockChart's `_shownTfRef` write turns it red.
//   C1 D painted, press 1m on a cold key (slow answer): no empty candle set and no blank frame before the 1m rows land;
//      the 1m rows then paint
//   C2 bounded: a 1m key that never answers shows the chart's loading skeleton after the bound (TF_SWITCH_EMPTY_HOLD_MS)
//   C3 (re-review of #3033) the 1m key first answers 503 `warming`, then rows: still no empty set and no blank frame
//      and the held frame is not dropped for the cold-load skeleton (red under the early-answer release, measured)
// Runs with the bar store on (the hold lives in its hook, and production builds run it). All prices are synthetic.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, cleanup, act, screen } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'


const T = vi.hoisted(() => ({ ts: null, series: [], onBar: null, push: null, empties: [] }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const W = 600
  const ts = {
    points: [], base: null, rightOffset: 0, barSpacing: 6, opts: { shiftVisibleRangeOnNewBar: true },
    subs: new Set(),
  }
  T.ts = ts
  const isWs = (p) => p && p.open === undefined && p.value === undefined
  const recompute = () => {
    const oldPts = ts.points
    const oldBase = ts.base
    const set = new Set()
    let newBase = null
    for (const s of T.series) for (const p of s.__data) set.add(p.time)
    const pts = [...set].sort((a, b) => a - b)
    for (const s of T.series) {
      for (let i = s.__data.length - 1; i >= 0; i--) {
        if (!isWs(s.__data[i])) { const ix = pts.indexOf(s.__data[i].time); if (newBase == null || ix > newBase) newBase = ix; break }
      }
    }
    const same = oldPts.length === pts.length && oldPts.every((t, i) => t === pts[i])
    if (oldPts.length && pts.length && oldBase != null && newBase != null) {
      const to = oldBase + ts.rightOffset
      const from = to - W / ts.barSpacing + 1
      const lastVisible = oldBase >= from && oldBase <= to
      const leftShift = pts[0] < oldPts[0]
      // LWC compares base INDEXES; with a prepend the old base moves right by the prepend count.
      const prepended = leftShift ? pts.indexOf(oldPts[0]) : 0
      const added = newBase > oldBase + prepended
      const needShift = lastVisible && !same && ts.opts.shiftVisibleRangeOnNewBar
      if (added && !leftShift && !needShift) ts.rightOffset -= (newBase - oldBase)
    }
    ts.points = pts
    ts.base = newBase
  }
  const makeSeries = (ctor, options) => {
    const s = {
      __ctor: ctor, __options: { ...(options || {}) }, __data: [],
      setData: (d) => { if (!(d || []).length && s.__ctor === real.CandlestickSeries) T.empties.push(Date.now()); s.__data = [...(d || [])]; recompute() },
      update: (p, historical) => {
        if (!p) return
        const i = s.__data.findIndex(d => d.time === p.time)
        if (historical) { if (i < 0) throw new Error('missing'); s.__data[i] = p; return }
        const last = s.__data[s.__data.length - 1]
        if (last && p.time < last.time) throw new Error('Cannot update oldest data')
        if (last && last.time === p.time) s.__data = [...s.__data.slice(0, -1), p]
        else s.__data = [...s.__data, p]
        recompute()
      },
      applyOptions: (o) => { Object.assign(s.__options, o || {}) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => s.__options,
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
      dataByIndex: () => null, data: () => s.__data, barsInLogicalRange: () => null,
      priceFormatter: () => ({ format: (p) => String(p) }),
    }
    T.series.push(s)
    return s
  }
  const range = () => {
    if (ts.base == null) return null
    const to = ts.base + ts.rightOffset
    return { from: to - W / ts.barSpacing + 1, to }
  }
  const timeScale = new Proxy({
    applyOptions: (o) => { Object.assign(ts.opts, o || {}); if (o && Number.isFinite(o.barSpacing)) ts.barSpacing = o.barSpacing },
    setVisibleLogicalRange: ({ from, to }) => {
      if (ts.base == null) return
      ts.barSpacing = W / (to - from + 1)
      ts.rightOffset = to - ts.base
    },
    getVisibleLogicalRange: () => range(),
    getVisibleRange: () => null, setVisibleRange: () => {}, fitContent: () => {},
    scrollToPosition: (p) => { ts.rightOffset = p }, scrollPosition: () => ts.rightOffset,
    timeToCoordinate: () => 0, coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({ ...ts.opts, barSpacing: ts.barSpacing, rightOffset: ts.rightOffset }),
    width: () => W, height: () => 40,
    barSpacing: () => ts.barSpacing,
  }, { get: (t, p) => (p in t ? t[p] : (typeof p === 'symbol' || p === 'then') ? undefined : () => undefined) })
  const chart = {
    addSeries: (ctor, options) => makeSeries(ctor, options),
    addCustomSeries: (_i, options) => makeSeries('custom', options),
    removeSeries: (s) => { const i = T.series.indexOf(s); if (i >= 0) T.series.splice(i, 1); recompute() },
    applyOptions: (o) => { if (o?.timeScale) Object.assign(ts.opts, o.timeScale) },
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    paneSize: () => ({ width: W, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {}, subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [0, 1, 2, 3].map(() => ({
      getHeight: () => 300, setHeight: () => {}, getHTMLElement: () => document.createElement('div'),
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    })),
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return { ...real, createChart: (_el, o) => { if (o?.timeScale) Object.assign(ts.opts, o.timeScale); return chart }, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../utils/barsIDB', async (orig) => {
  const real = await orig()
  return { ...real, idbGet: async () => null, idbPut: async () => {} }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
// The push stream is NOT mocked away: tests drive Writer B through the captured onBar.
vi.mock('../hooks/useRealtimeBars', () => ({ default: ({ onBar }) => { T.onBar = onBar; return T.push || {} } }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData']) ctx[m] = () => {}
  return ctx
}


// Wed 2026-11-11 12:47:20 ET (EST = UTC-5): mid-session.
const NOW_ISO = '2026-11-11T17:47:20Z'
const clock = pinWallClock(NOW_ISO)
afterAll(() => clock.restore())

let StockChart, TF_SWITCH_EMPTY_HOLD_MS, BARSTORE_ON, toChartTime
const et = (d, h, m) => Math.floor(Date.UTC(2026, 10, d, h + 5, m) / 1000)
const NOW = Math.floor(Date.parse(NOW_ISO) / 1000)
function minutes() {
  const out = []
  for (let t = et(11, 9, 30); t <= NOW; t += 60) {
    const k = (t / 60) % 97
    const o = 50 + (k % 13) * 0.1, c = o + ((k % 3) - 1) * 0.07
    out.push({ t, o, h: Math.max(o, c) + 0.03, l: Math.min(o, c) - 0.03, c, v: 100 + k })
  }
  return out
}
function days(n = 300) {
  const out = []
  const end = Date.UTC(2026, 10, 10)
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(end - i * 86400000).toISOString().slice(0, 10)
    out.push({ t, o: 50, h: 51, l: 49, c: 50.5, v: 1000 })
  }
  return out
}
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
// the server: daily answers at once; the 1m key answers after `minuteLatency` (Infinity = never)
function serve({ minuteLatency, warmingFirst = false }) {
  let warm = warmingFirst ? 1 : 0
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const ok = (body) => { const r = { ok: true, status: 200, headers: { get: () => null }, json: async () => body }; r.clone = () => r; return r }
    const h = u.match(/\/api\/bars-history\/([^?]+)/)
    if (h) return Promise.resolve(ok({ ticker: 'SYN', tf: 'D', sealed: true, bars: days() }))
    const m = u.match(/\/api\/bars\/([^?]+)\?tf=([^&]+)/)
    if (!m) return Promise.resolve(ok({}))
    if (m[2] !== '1') return Promise.resolve(ok({ ticker: 'SYN', tf: m[2], bars: days() }))
    if (warm > 0) {
      warm--
      const r = { ok: false, status: 503, headers: { get: () => '1' }, json: async () => ({ ticker: 'SYN', tf: '1', bars: [], error: 'warming' }) }
      r.clone = () => r
      return new Promise((res) => setTimeout(() => res(r), 60))
    }
    if (!Number.isFinite(minuteLatency)) return new Promise(() => {})
    return new Promise((res) => setTimeout(() => res(ok({ ticker: 'SYN', tf: '1', bars: minutes() })), minuteLatency))
  }))
}
const candle = () => T.series.find(s => s.__ctor === _real.CandlestickSeries)
let _real = null
const realCandles = () => (candle()?.__data || []).filter(p => p.open !== undefined)

beforeEach(async () => {
  clock.retarget(NOW_ISO)
  cleanup()
  T.series.length = 0; T.empties.length = 0; T.push = null; T.onBar = null
  _real = await vi.importActual('lightweight-charts')
  const mod = await loadWithBarStore(true, () => import('./StockChart'))
  StockChart = mod.default; BARSTORE_ON = mod.__barStore
  ;({ TF_SWITCH_EMPTY_HOLD_MS } = await import('./chart/useBarSnapshotBars'))
  ;({ toChartTime } = await import('./chart/barTime'))
  try { localStorage.setItem('barspack.version', '2026-11-10') } catch { /* */ }
})

async function dailyThenPress1m({ minuteLatency, warmingFirst = false }) {
  serve({ minuteLatency, warmingFirst })
  const view = render(<StockChart sym="SYN" tf="D" backgroundWarm={false} forceExtendedHours={false} />)
  await wait(500)
  expect(BARSTORE_ON).toBe(true)
  expect(realCandles().length, 'the daily chart painted').toBeGreaterThan(0)
  T.empties.length = 0
  const blanks = []
  const covers = []   // an overlay over the chart before the rows: the loading skeleton or the failed-load card
  const t0 = Date.now()
  const id = setInterval(() => {
    if (!realCandles().length) blanks.push(Date.now())
    const c = document.querySelector('[aria-busy="true"]') ? 'skeleton' : /Failed to load/.test(document.body.textContent || '') ? 'failed' : null
    if (c) covers.push({ c, at: Date.now() - t0 })
  }, 2)
  view.rerender(<StockChart sym="SYN" tf="1" backgroundWarm={false} forceExtendedHours={false} />)
  return { view, blanks, covers, t0, stop: () => clearInterval(id) }
}

describe('a timeframe press from a daily chart never empties the chart (real StockChart)', () => {
  it('C1 D painted, 1m pressed on a cold key: no empty set and no blank frame before the 1m rows land, then they paint', async () => {
    const { blanks, stop } = await dailyThenPress1m({ minuteLatency: 400 })
    await wait(250)
    expect(T.empties, 'an empty candle set was handed to the chart before the 1m rows landed').toEqual([])
    expect(blanks, 'a blank frame before the 1m rows landed').toEqual([])
    await wait(700)
    stop()
    const last = realCandles().at(-1)
    expect(last?.time, 'the 1m rows painted').toBe(toChartTime(minutes().at(-1).t))
    expect(T.empties).toEqual([])
    expect(blanks).toEqual([])
  })

  it('C3 the 1m key answers 503 warming first, then rows: no empty set and no blank frame before the rows land', async () => {
    const { blanks, covers, t0, stop } = await dailyThenPress1m({ minuteLatency: 50, warmingFirst: true })
    let landed = null
    for (let i = 0; i < 400 && landed == null; i++) {
      await wait(10)
      if (realCandles().at(-1)?.time === toChartTime(minutes().at(-1).t)) landed = Date.now() - t0
    }
    stop()
    // the held frame is not dropped for the cold-load skeleton (150 ms): only the timeframe hold's own late skeleton
    // (StockChart TF_SWITCH_HOLD_SKELETON_MS, 1200 ms) may cover it. Measured under the early-answer release this rail
    // replaces: the skeleton at ~270 ms, the frame dropped; with the hold: the first cover at ~1220 ms.
    expect(landed, 'the 1m rows landed').not.toBeNull()
    expect(covers.filter((x) => x.c === 'failed'), 'the failed-load card over the held frame').toEqual([])
    expect(covers.length ? covers[0].at : Infinity, 'the held frame dropped for the cold-load skeleton').toBeGreaterThanOrEqual(1000)
    const asks = fetch.mock.calls.map(([u]) => String(u)).filter((u) => /\/api\/bars\/SYN\?tf=1(&|$)/.test(u))
    expect(asks.length, 'the 1m key was asked again after the warming answer').toBeGreaterThanOrEqual(2)
    expect(realCandles().at(-1)?.time, 'the 1m rows painted').toBe(toChartTime(minutes().at(-1).t))
    expect(T.empties, 'an empty candle set before the 1m rows landed').toEqual([])
    expect(blanks, 'a blank frame before the 1m rows landed').toEqual([])
  }, 15_000)

  it('C2 bounded: a 1m key that never answers shows the loading skeleton after TF_SWITCH_EMPTY_HOLD_MS', async () => {
    const { stop } = await dailyThenPress1m({ minuteLatency: Infinity })
    await wait(TF_SWITCH_EMPTY_HOLD_MS + 600)
    stop()
    expect(screen.queryByRole('status', { busy: true }) || document.querySelector('[aria-busy="true"]'), 'the loading skeleton').not.toBeNull()
  }, 15_000)
})
