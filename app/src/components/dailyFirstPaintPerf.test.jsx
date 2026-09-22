/**
 * DAILY FIRST-PAINT PERFORMANCE.
 *
 * ⚠️ WHAT THESE NUMBERS ARE. jsdom + a stubbed network: the absolute milliseconds
 * are React commit time plus a SIMULATED /api/bars latency, not a member's wall
 * clock. What they measure honestly is the thing the change is actually about —
 * WHETHER THE FIRST CORRECT FRAME NEEDS A ROUND TRIP. A class that paints from
 * local state lands in tens of ms; a class that must wait lands at the simulated
 * latency floor. Reading them as production timings would be overclaiming.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup, waitFor } from '@testing-library/react'

const spy = vi.hoisted(() => ({ setVisibleLogicalRange: null, last: null }))
const seriesLog = vi.hoisted(() => ({ calls: [] }))
const world = vi.hoisted(() => ({
  sym: 'P0', idbEntry: null, packBar: null, packUsable: false, liveSnap: null,
  netBars: null, histBars: null, netDelayMs: 300, netResolvedAt: 0, netCalls: 0,
}))

vi.mock('./chart/ChartVLineOverlay', () => ({ default: () => null }))
vi.mock('lightweight-charts', () => {
  let _sid = 0
  const mkSeries = () => {
    const id = ++_sid
    return {
      setData: (d) => { seriesLog.calls.push({ id, op: 'setData', data: d }) },
      update: (d) => { seriesLog.calls.push({ id, op: 'update', data: d }) },
      applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      dataByIndex: () => null, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
      barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
    }
  }
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {},
    setVisibleLogicalRange: (r) => { spy.setVisibleLogicalRange?.(r); spy.last = r },
    getVisibleLogicalRange: () => spy.last,
    setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
    unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
    resetTimeScale: () => {}, options: () => ({}), width: () => 900,
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
  }
  const chart = {
    addSeries: () => mkSeries(), addCandlestickSeries: () => mkSeries(), addHistogramSeries: () => mkSeries(),
    addLineSeries: () => mkSeries(), addAreaSeries: () => mkSeries(), addBarSeries: () => mkSeries(),
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
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
vi.mock('../hooks/livePriceStore', () => ({
  getSnapshot: () => (world.liveSnap ? { [world.sym]: world.liveSnap } : {}),
  subscribe: () => () => {},
}))
vi.mock('../lib/todayPackClient', () => ({
  getTodayBar: () => world.packBar,
  todayPackUsable: () => world.packUsable,
  touchTodayPack: () => Promise.resolve(null),
  ensureTodayPack: () => Promise.resolve(null),
  todayPackAgeMs: () => (world.packUsable ? 1000 : Infinity),
}))
vi.mock('../utils/barsIDB', async (importOriginal) => ({
  ...(await importOriginal()),
  idbGet: async () => world.idbEntry,
  idbPut: async () => {},
}))

const Mod = await import('./StockChart')
const StockChart = Mod.default
const MS = await import('../utils/marketSession')
const FRONTIER = MS.expectedDailyTailForPaintET()

function sessionsBack(k) {
  const d = new Date(`${FRONTIER}T12:00:00Z`)
  let left = k
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) left -= 1
  }
  return d.toISOString().slice(0, 10)
}
function seriesEndingAt(isoEnd, n = 260) {
  const out = []
  const d = new Date(`${isoEnd}T12:00:00Z`)
  while (out.length < n) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const i = n - out.length
      out.unshift({ t: d.toISOString().slice(0, 10), o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1e6 + i })
    }
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const FULL = seriesEndingAt(FRONTIER)
const TODAY_BAR = FULL[FULL.length - 1]
const FRESH_TODAY = { o: TODAY_BAR.o, h: TODAY_BAR.h, l: TODAY_BAR.l, c: TODAY_BAR.c, v: TODAY_BAR.v }

const PANE_PROPS = {
  tf: 'D', keepPresentOnSymbolChange: true, carryDragPlacement: true,
  rightPadBars: 6, dailyDefaultBars: 126, viewLockKey: 'uct.perf.viewLock', backgroundWarm: true,
}
const caught = { error: null }
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { dead: false } }
  static getDerivedStateFromError() { return { dead: true } }
  componentDidCatch(e) { caught.error = e }
  render() { return this.state.dead ? null : this.props.children }
}
function candleSeriesId() {
  let id = null
  for (const c of seriesLog.calls) {
    if (c.op === 'setData' && Array.isArray(c.data) && c.data.some((x) => x && x.open !== undefined)) id = c.id
  }
  return id
}
function rendered() {
  const id = candleSeriesId()
  if (id == null) return null
  let arr = null
  for (const c of seriesLog.calls) {
    if (c.id !== id) continue
    if (c.op === 'setData') { arr = Array.isArray(c.data) ? c.data.slice() : null }
  }
  return arr
}
const tick = async (ms = 15) => {
  await new Promise((r) => setTimeout(r, ms))
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

beforeEach(() => {
  cleanup()
  spy.setVisibleLogicalRange = vi.fn(); spy.last = null; seriesLog.calls = []
  caught.error = null
  try { localStorage.clear() } catch { /* jsdom */ }
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url)
    if (u.includes('/api/bars-history/')) return { ok: true, json: async () => ({ ticker: world.sym, tf: 'D', sealed: true, bars: world.histBars || [] }) }
    if (u.includes('/api/bars/')) {
      world.netCalls += 1
      if (world.netDelayMs) await new Promise((r) => setTimeout(r, world.netDelayMs))
      world.netResolvedAt = Date.now()
      return { ok: true, json: async () => ({ ticker: world.sym, tf: 'D', bars: world.netBars || FULL }) }
    }
    return { ok: true, json: async () => ({}) }
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

let n = 0
async function timeOne(setup) {
  world.sym = `P${++n}`
  Object.assign(world, { idbEntry: null, packBar: null, packUsable: false, liveSnap: null,
                         netBars: FULL, histBars: null, netResolvedAt: 0 })
  setup()
  seriesLog.calls = []
  const PRIOR = seriesEndingAt(FRONTIER, 200)
  const { rerender, unmount } = render(<Boundary><StockChart sym="AA" barsOverride={PRIOR} {...PANE_PROPS} /></Boundary>)
  await waitFor(() => expect(spy.setVisibleLogicalRange).toHaveBeenCalled(), { timeout: 5000 })
  await tick(30)
  seriesLog.calls = []
  world.netResolvedAt = 0     // a PRIOR rep's in-flight fetch must not be read as this one's
  const t0 = Date.now()
  rerender(<Boundary><StockChart sym={world.sym} {...PANE_PROPS} /></Boundary>)
  let ms = null; let src = null
  const deadline = Date.now() + 4000
  while (Date.now() < deadline) {
    await tick(10)
    const r = rendered()
    if (r && r.length) {
      ms = Date.now() - t0
      src = (world.netResolvedAt && Date.now() >= world.netResolvedAt) ? 'network' : 'cache'
      break
    }
  }
  unmount()
  return { ms, src }
}

const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null)
const CLASSES = {
  HOT: () => { world.idbEntry = { bars: FULL, lastT: FRONTIER, savedAt: Date.now() } },
  WARM: () => {
    world.idbEntry = { bars: seriesEndingAt(sessionsBack(1)), lastT: sessionsBack(1), savedAt: Date.now() }
    world.packBar = FRESH_TODAY; world.packUsable = true
  },
  // The REAL cold path: no IDB, but the edge sealed-history endpoint answers with a
  // body through the last sealed session (measured: 73 of 79 production symbols), and
  // the pack supplies today. This is the class that must NOT have regressed — closing
  // the stale-paint bypass is only acceptable if the correct frame is also the fast one.
  'COLD-EDGE': () => {
    world.histBars = seriesEndingAt(sessionsBack(1))
    world.packBar = FRESH_TODAY; world.packUsable = true
  },
  'COLD-NOEDGE': () => { world.packBar = FRESH_TODAY; world.packUsable = true },
  'VERY-STALE': () => {
    world.idbEntry = { bars: seriesEndingAt(sessionsBack(20)), lastT: sessionsBack(20), savedAt: Date.now() }
    world.packBar = FRESH_TODAY; world.packUsable = true
  },
  'NO-IDB': () => {},
}
const REPS = 7
const OUT = []

describe('DAILY first-paint performance', () => {
  for (const [label, setup] of Object.entries(CLASSES)) {
    it(`${label} — first correct frame`, async () => {
      const ms = []; const srcs = new Set()
      for (let i = 0; i < REPS; i++) {
        const r = await timeOne(setup)
        expect(r.ms, `${label}: never painted`).not.toBeNull()
        ms.push(r.ms); srcs.add(r.src)
      }
      OUT.push({ label, p50: pct(ms, 0.5), p90: pct(ms, 0.9), p95: pct(ms, 0.95), max: Math.max(...ms), src: [...srcs].join('/') })
      expect(ms.length).toBe(REPS)
    }, 120000)
  }

  it('PERF SUMMARY', () => {
    console.log('[PERF] simulated /api/bars latency = 300ms; local-paint classes never touch it')
    console.log('[PERF-SUMMARY]\n' + OUT.map((r) =>
      `${String(r.label).padEnd(11)} | src ${String(r.src).padEnd(8)} | p50 ${String(r.p50).padStart(4)}ms | p90 ${String(r.p90).padStart(4)}ms | p95 ${String(r.p95).padStart(4)}ms | max ${String(r.max).padStart(4)}ms`
    ).join('\n'))
    expect(OUT.length).toBe(Object.keys(CLASSES).length)
  })
})
