import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { pinWallClock } from '../../testing/pinnedWallClock'

// ─── GOLDEN: adapter.toSeries ≡ TODAY's StockChart shaping ─────────────────────
//
// Risk named in BARSTORE-SPEC ("daily time-shape drift"): the adapter replaces
// StockChart's sessionBars → filteredBars → sessionAppliedBars → displayBars → ohlcData /
// volData chain. Part 1 renders the REAL StockChart (barsOverride, so no network) and
// captures what it hands the candle + volume series; the adapter, fed the same bars as a
// store snapshot (sealed + developing split), must produce the same points — time, O/H/L/C,
// volume value. Colors are paint styling (they stay in StockChart until P3-S3) and the
// load-anchor WHITESPACE seed is a framing device the framing contract replaces, so
// whitespace points are excluded on the StockChart side.
// Part 2 covers the inputs a prop cannot reach (internal replayIndex, the session preview
// candle needs a pre/post wall clock + an ext aggregate fetch): the reference there is
// StockChart's memo chain transcribed line-for-line (StockChart.jsx sessionBars /
// filteredBars / sessionAppliedBars / displayBars / ohlcData) over the same helpers.
// All prices are synthetic.

const T = vi.hoisted(() => ({ series: [] }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const ts = { range: null }
  const makeSeries = (ctor, options) => {
    const s = {
      __ctor: ctor, __options: { ...(options || {}) }, __data: [],
      setData: (d) => { s.__data = [...(d || [])] },
      update: (p) => {
        const i = s.__data.findIndex(d => d.time === p.time)
        if (i >= 0) s.__data[i] = p; else s.__data = [...s.__data, p]
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
  const timeScale = new Proxy({
    setVisibleLogicalRange: (r) => { ts.range = r }, getVisibleLogicalRange: () => ts.range,
    getVisibleRange: () => null, setVisibleRange: () => {}, fitContent: () => {},
    timeToCoordinate: () => 0, coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({ barSpacing: 6, rightOffset: 3 }), width: () => 600, height: () => 40, barSpacing: () => 6,
  }, { get: (t, p) => (p in t ? t[p] : (typeof p === 'symbol' || p === 'then') ? undefined : () => undefined) })
  const chart = {
    addSeries: (ctor, options) => makeSeries(ctor, options),
    addCustomSeries: (_i, options) => makeSeries('custom', options),
    removeSeries: (s) => { const i = T.series.indexOf(s); if (i >= 0) T.series.splice(i, 1) },
    applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale, paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {}, subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [0, 1, 2, 3].map(() => ({
      getHeight: () => 300, setHeight: () => {}, getHTMLElement: () => document.createElement('div'),
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    })),
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../../utils/barsIDB', async (orig) => {
  const real = await orig()
  return { ...real, idbGet: async () => null, idbPut: async () => {} }
})
vi.mock('../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData']) ctx[m] = () => {}
  return ctx
}

// Wed 2026-11-11 12:47:20 ET — after the Nov 1 DST change, so the fixture spans both offsets.
const NOW_ISO = '2026-11-11T17:47:20Z'
const clock = pinWallClock(NOW_ISO)
afterAll(() => clock.restore())

const { default: StockChart } = await import('../../components/StockChart')
const { toSeries, composePoints, _resetAdapterMemos } = await import('./adapter')
const { toChartTime } = await import('../../components/chart/barTime')
const { foldOffGridBars } = await import('../../components/chart/offGridBars')
const { applySessionCandle } = await import('../../components/chart/sessionPreview')
const { toHeikinAshi } = await import('../../components/chart/indicators')
const { etMinutesOfUnix } = await import('../../utils/marketSession')

// ── synthetic fixtures (deterministic zig-zag, never real prices) ─────────────
const etUnix = (y, mo, d, h, m, s = 0) => {
  // ET wall clock → unix, DST-aware via the shared offset owner.
  const guess = Date.UTC(y, mo - 1, d, h, m, s) / 1000 + 18000
  const wall = Date.UTC(y, mo - 1, d, h, m, s) / 1000
  return toChartTime(guess) === wall ? guess : guess - 3600
}
const px = (k) => {
  const base = 40 + (k % 17) * 0.13 - (k % 5) * 0.07
  const o = base, c = base + ((k % 3) - 1) * 0.05
  return { o, h: Math.max(o, c) + 0.02 + (k % 4) * 0.01, l: Math.min(o, c) - 0.02 - (k % 3) * 0.01, c, v: 1000 + (k % 29) * 7 }
}
// 5m bars 04:00-20:00 ET on Oct 30 (EDT), Nov 10 (EST), Nov 11 through 12:45 (the developing
// bucket), plus ONE off-grid stray with no twin (Oct 30 20:02:13) and one with a
// twin (Nov 10 16:35:50 beside 16:35:00).
function intraday5m() {
  const out = []
  let k = 0
  const day = (y, mo, d, endH, endM) => {
    for (let mins = 4 * 60; mins < 20 * 60; mins += 5) {
      const h = Math.floor(mins / 60), m = mins % 60
      if (h > endH || (h === endH && m > endM)) break
      out.push({ t: etUnix(y, mo, d, h, m), ...px(k++) })
    }
  }
  day(2026, 10, 30, 19, 55); day(2026, 11, 10, 19, 55); day(2026, 11, 11, 12, 45)
  out.push({ t: etUnix(2026, 10, 30, 20, 2, 13), ...px(k++) })   // lone stray: bucket 20:00 is empty
  out.push({ t: etUnix(2026, 11, 10, 16, 35, 50), ...px(k++) })
  return out.sort((a, b) => a.t - b.t)
}
function daily() {
  const out = []
  let k = 3
  for (let d = new Date(Date.UTC(2026, 6, 1)); d <= new Date(Date.UTC(2026, 10, 11)); d = new Date(d.getTime() + 86400000)) {
    const wd = d.getUTCDay()
    if (wd === 0 || wd === 6) continue
    out.push({ t: d.toISOString().slice(0, 10), ...px(k++) })
  }
  return out
}
// A store snapshot of the same bars: sealed = all but the newest, developing = the newest.
function snapshotOf(key, bars, baseRev = 1) {
  const sealed = bars.slice(0, -1)
  const d = bars[bars.length - 1]
  return Object.freeze({ key, bars: sealed, developing: { ...d, rev: 1, src: 'server' }, baseRev, devRev: 1, status: 'current' })
}

const isWs = (p) => p && p.open === undefined && p.value === undefined
const candleSeries = (real) => T.series.find(s => s.__ctor === real.CandlestickSeries)
const volumeSeries = (real) => T.series.find(s => s.__ctor === real.HistogramSeries)
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
const HA = { heikinAshi: true }
const NO_HA = { heikinAshi: false }

let real
beforeEach(async () => {
  clock.retarget(NOW_ISO)
  cleanup(); T.series.length = 0; _resetAdapterMemos()
  real = await vi.importActual('lightweight-charts')
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })))
})

async function captureStockChart({ tf, bars, ext, settings, replayCutoff = null }) {
  render(<StockChart sym="SYN" tf={tf} barsOverride={bars} backgroundWarm={false}
    forceExtendedHours={ext} settingsOverride={settings} onSettingsPersist={() => {}} replayCutoff={replayCutoff} />)
  await wait(300)
  const c = candleSeries(real), v = volumeSeries(real)
  return {
    candles: (c?.__data || []).filter(p => !isWs(p)).map(({ time, open, high, low, close }) => ({ time, open, high, low, close })),
    volume: (v?.__data || []).filter(p => p.value !== undefined).map(({ time, value }) => ({ time, value })),
  }
}
function adapterPoints(snapshot, view) {
  const r = toSeries(snapshot, view)
  return { candles: composePoints(r.base.candles, r.tail.candles), volume: composePoints(r.base.volume, r.tail.volume) }
}

describe('golden part 1: adapter ≡ the real StockChart (barsOverride)', () => {
  const cases = [
    { name: '5m extended hours (off-grid strays folded, DST-spanning)', tf: '5', bars: intraday5m, ext: true, settings: NO_HA },
    { name: '5m regular hours (RTH filter)', tf: '5', bars: intraday5m, ext: false, settings: NO_HA },
    { name: '5m RTH Heikin-Ashi (developing HA bar continued)', tf: '5', bars: intraday5m, ext: false, settings: HA },
    { name: '5m ETH replayCutoff 2026-11-10', tf: '5', bars: intraday5m, ext: true, settings: NO_HA, replayCutoff: '2026-11-10' },
    { name: 'daily business-day strings', tf: 'D', bars: daily, ext: false, settings: NO_HA },
    { name: 'daily Heikin-Ashi', tf: 'D', bars: daily, ext: false, settings: HA },
    { name: 'daily replayCutoff 2026-10-15', tf: 'D', bars: daily, ext: false, settings: NO_HA, replayCutoff: '2026-10-15' },
  ]
  for (const c of cases) {
    it(c.name, async () => {
      const bars = c.bars()
      const golden = await captureStockChart({ tf: c.tf, bars, ext: c.ext, settings: c.settings, replayCutoff: c.replayCutoff })
      expect(golden.candles.length).toBeGreaterThan(10)
      const got = adapterPoints(snapshotOf(`SYN_${c.tf}`, bars), {
        tf: c.tf, showExtended: c.ext, heikinAshi: c.settings.heikinAshi, replayIndex: null, replayCutoff: c.replayCutoff,
      })
      expect(got.candles).toEqual(golden.candles)
      expect(got.volume).toEqual(golden.volume)
      // The comparison discriminates: each view input the case sets, flipped, no longer matches.
      const view = { tf: c.tf, showExtended: c.ext, heikinAshi: c.settings.heikinAshi, replayCutoff: c.replayCutoff }
      const snap = snapshotOf(`SYN_${c.tf}`, bars)
      expect(adapterPoints(snap, { ...view, heikinAshi: !view.heikinAshi }).candles).not.toEqual(golden.candles)
      if (c.tf === '5') expect(adapterPoints(snap, { ...view, showExtended: !view.showExtended }).candles.length).not.toBe(golden.candles.length)
      if (c.replayCutoff) expect(adapterPoints(snap, { ...view, replayCutoff: null }).candles.length).toBeGreaterThan(golden.candles.length)
    })
  }

  it('the fixture exercises the off-grid fold (a stray without a twin is re-keyed, with a twin dropped)', () => {
    const bars = intraday5m()
    const r = toSeries(snapshotOf('SYN_5', bars), { tf: '5', showExtended: true })
    const pts = composePoints(r.base.candles, r.tail.candles)
    expect(pts.length).toBe(bars.length - 1)   // the twinned stray dropped; the lone one re-keyed to 20:00
    expect(pts.every(p => p.time % 300 === 0)).toBe(true)
  })

  it('the DST rail: an Oct 30 (EDT) 09:30 bar and a Nov 10 (EST) 09:30 bar both label 09:30', () => {
    const bars = intraday5m()
    const r = toSeries(snapshotOf('SYN_5', bars), { tf: '5', showExtended: false })
    const nineThirty = composePoints(r.base.candles, r.tail.candles)
      .filter(p => ((p.time % 86400) + 86400) % 86400 === 9.5 * 3600)
    expect(nineThirty.length).toBe(3)   // Oct 30, Nov 10, Nov 11
  })
})

// ── Part 2: StockChart's memo chain transcribed (internal state the props can't reach) ──
function referenceChain(bars, { tf, showExtended, heikinAshi, replayMode, replayIndex, replayCutoff, sessionCandle }) {
  const isIntraday = ['1', '5', '15', '30', '60'].includes(tf)
  let sessionBars = bars
  if (bars && isIntraday) {
    const gridBars = foldOffGridBars(bars, tf, { showExtended })
    sessionBars = showExtended ? gridBars : gridBars.filter(b => {
      if (typeof b.t !== 'number') return true
      const mins = etMinutesOfUnix(b.t)
      return mins >= 570 && mins < 960
    })
  }
  let out = (replayMode && replayIndex != null) ? sessionBars?.slice(0, replayIndex + 1) : sessionBars
  if (replayCutoff && out?.length) {
    out = out.filter(b => (typeof b.t === 'number'
      ? new Date(b.t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) <= replayCutoff
      : String(b.t).slice(0, 10) <= replayCutoff))
  }
  const filteredBars = out
  const sessionAppliedBars = sessionCandle ? applySessionCandle(filteredBars, sessionCandle) : filteredBars
  const displayBars = heikinAshi ? toHeikinAshi(sessionAppliedBars) : sessionAppliedBars
  const adjustTime = (t) => (typeof t === 'number' ? toChartTime(t) : t)
  return {
    candles: displayBars.map(b => ({ time: adjustTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })),
    volume: sessionAppliedBars.map(b => ({ time: adjustTime(b.t), value: b.v })),
    filteredBars, sessionAppliedBars, displayBars,
  }
}

describe('golden part 2: replay slice + session preview candle (transcribed chain)', () => {
  const rng = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  it('replayIndex over every position (intraday ETH/RTH, daily; with and without HA)', () => {
    for (const [tf, mk] of [['5', intraday5m], ['D', daily]]) {
      const bars = mk()
      for (const showExtended of tf === '5' ? [true, false] : [false]) {
        for (const heikinAshi of [false, true]) {
          const n = referenceChain(bars, { tf, showExtended }).filteredBars.length
          const r = rng(n)
          const idxs = [0, 1, n - 3, n - 2, n - 1, n, ...Array.from({ length: 12 }, () => Math.floor(r() * n))]
          for (const replayIndex of idxs) {
            const view = { tf, showExtended, heikinAshi, replayIndex }
            const ref = referenceChain(bars, { ...view, replayMode: true })
            const got = adapterPoints(snapshotOf(`SYN_${tf}`, bars), view)
            expect({ tf, showExtended, heikinAshi, replayIndex, c: got.candles }).toEqual({ tf, showExtended, heikinAshi, replayIndex, c: ref.candles })
            expect(got.volume).toEqual(ref.volume)
          }
        }
      }
    }
  })

  it('session preview candle: extends the newest bar (same day) or appends one (next day), base or developing anchor, HA on/off', () => {
    const bars = daily()
    const last = bars[bars.length - 1].t
    const extAgg = { open: 41.1, high: 41.9, low: 40.7, close: 41.3, volume: 777 }
    for (const sessionCandle of [
      { curTime: last, extAgg, extPrice: 41.5 },            // post-market: extend today's bar
      { curTime: '2026-11-12', extAgg, extPrice: 41.5 },    // pre-market: a new preview candle
      { curTime: '2026-11-12', extAgg: null, extPrice: 41.5 },
      { curTime: last, extAgg: null, extPrice: null },      // nothing to apply → unchanged
    ]) {
      for (const heikinAshi of [false, true]) {
        for (const withDev of [true, false]) {
          const snap = withDev ? snapshotOf('SYN_D', bars)
            : Object.freeze({ key: 'SYN_D', bars, developing: null, baseRev: 2, devRev: 0 })
          const ref = referenceChain(bars, { tf: 'D', heikinAshi, sessionCandle })
          const r = toSeries(snap, { tf: 'D', heikinAshi, sessionCandle })
          expect(composePoints(r.base.candles, r.tail.candles)).toEqual(ref.candles)
          expect(composePoints(r.base.volume, r.tail.volume)).toEqual(ref.volume)
          expect(r.filteredBars()).toEqual(ref.filteredBars)
          expect(r.sessionAppliedBars()).toEqual(ref.sessionAppliedBars)
          expect(r.sessionApplied).toBe(ref.sessionAppliedBars !== ref.filteredBars)
        }
      }
    }
  })
})
