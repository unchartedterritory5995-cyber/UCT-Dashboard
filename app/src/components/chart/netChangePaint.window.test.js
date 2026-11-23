/**
 * NEXT-ROW CHART WALKS, ITEM (ii), CANDLES: THE NET-CHANGE COLOURS ARE PAINTED ON THE ROWS THE LIBRARY IS HANDED
 * (2026-11-23). The production profile of a next-row press: the candle series' setData wrapper re-mapped EVERY row
 * (one new object per bar, ~1.3 ms on a ~8,000-bar daily chart) while the render-window facade then hands the library
 * a window of ~750 rows of it.
 *   C1 the series receives exactly what it received before, on every colour mode (net change, open-close, one colour,
 *      hollow, no body, Sunrise's black inside bars), with explicit colours, whitespace, nulls and rows with no close;
 *      the developing-bar refs are the same, and so are live updates after it (a new bar, the same bar again)
 *   C2 through the render window, on the real renderer: the library holds the same painted rows as before, after the
 *      load, after the view extends the window left, and after a live update
 *   C3 only the window's rows are painted: the colours are read for about the window's bars, not every bar, and the
 *      rows left of the window stay as they came (the app's `data()` still holds every row)
 *   C4 the rows an extension adds keep the colours of the setData that brought them: a colour change made after it
 *      (StockChart's netColorsRef moves every render) reaches the chart with the next setData, as before
 *   C5 the paint from any row on equals the whole pass from that row on (`paintNetFrom(rows, from)`), for EVERY `from`,
 *      on every mode, with whitespace and null rows before `from`: the step back to the previous row with a close
 * (The fixture's gold rows sit OFF the facade's 250-row window grid: on it, every window started on a gold row, which
 * the paint leaves alone, and a paint with no step back at all passed C2 and C4. C5 rails the step back directly.)
 *
 * The reference below is the wrap exactly as it was before this change (StockChart.jsx updateChart at 44a7defafb).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createChart, CandlestickSeries } from 'lightweight-charts'
import { createWindowedChart, renderWindowRows, RENDER_WINDOW_OFF_KEY } from './windowedChart'
import { installNetChangePaint, paintNetFrom, _hollowFill } from './netChangePaint'
import { wrapSeriesForBarColours, applyBarColours } from './engine/barColours'

// ── the reference: the wrap's setData / update as they were (44a7defafb), verbatim but for `NC` being an argument ──
function refPaintNet(bar, prevClose, prevBar, NC) {
  const _isInside = (b, pb) => (pb && b.high != null && b.low != null && pb.high != null && pb.low != null && b.high <= pb.high && b.low >= pb.low)
  if (!bar || bar.close == null) return bar
  if (bar.color != null) return bar
  if (NC.insideBlack && _isInside(bar, prevBar)) {
    const openUpIn = bar.open != null ? bar.close >= bar.open : true
    return { ...bar, color: (NC.noBody || (NC.hollow && openUpIn)) ? 'rgba(0,0,0,0)' : '#000000', borderColor: '#000000', wickColor: '#000000' }
  }
  if (NC.mode === 'openclose') return bar
  if (NC.mode === 'onecolor') {
    const up = bar.open != null ? bar.close >= bar.open : true
    const body = NC.noBody ? 'rgba(0,0,0,0)' : (NC.hollow && up) ? _hollowFill(NC.one) : NC.one
    return { ...bar, color: body, borderColor: NC.one, wickColor: NC.one }
  }
  let up
  if (NC.mode === 'netchange') {
    if (prevClose == null) return bar
    up = bar.close >= prevClose
  } else {
    up = bar.open != null ? bar.close >= bar.open : true
  }
  const openUp = bar.open != null ? bar.close >= bar.open : up
  const body = NC.noBody ? 'rgba(0,0,0,0)' : (NC.hollow && openUp) ? _hollowFill(up ? NC.up : NC.down) : (up ? NC.up : NC.down)
  return { ...bar, color: body, borderColor: (up ? NC.borUp : NC.borDown), wickColor: (up ? NC.wickUp : NC.wickDown) }
}
function refSetData(data, NC) {
  let prev = null, lastPrev = null, prevBar = null, lastPrevBar = null
  const painted = data.map((b) => {
    if (b && b.close != null) {
      lastPrev = prev
      lastPrevBar = prevBar
      const out = refPaintNet(b, prev, prevBar, NC)
      prev = b.close
      prevBar = { high: b.high, low: b.low }
      return out
    }
    return b
  })
  return { painted, refs: { netPrevClose: lastPrev, lastNetClose: prev, netPrevBar: lastPrevBar, lastNetBar: prevBar, lastNetTime: painted.length ? data[data.length - 1]?.time : null } }
}
function refUpdate(bar, r, NC) {
  if (!bar || bar.close == null) return { out: bar, r }
  const isNewBar = r.lastNetTime != null && bar.time > r.lastNetTime
  const prevClose = isNewBar ? r.lastNetClose : r.netPrevClose
  const prevBar = isNewBar ? r.lastNetBar : r.netPrevBar
  const out = refPaintNet(bar, prevClose, prevBar, NC)
  const n = { ...r }
  if (isNewBar) { n.netPrevClose = r.lastNetClose; n.netPrevBar = r.lastNetBar; n.lastNetTime = bar.time }
  n.lastNetClose = bar.close
  n.lastNetBar = { high: bar.high, low: bar.low }
  return { out, r: n }
}

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────
const NC_NET = { mode: 'netchange', up: '#22aa22', down: '#aa2222', one: '#888888', borUp: '#33bb33', borDown: '#bb3333',
  wickUp: '#44cc44', wickDown: '#cc4444', hollow: false, insideBlack: false, noBody: false }
const MODES = {
  net: NC_NET,
  hollow: { ...NC_NET, hollow: true },
  noBody: { ...NC_NET, noBody: true },
  oneColor: { ...NC_NET, mode: 'onecolor' },
  oneHollow: { ...NC_NET, mode: 'onecolor', hollow: true },
  openClose: { ...NC_NET, mode: 'openclose' },
  sunrise: { ...NC_NET, insideBlack: true, hollow: true },
  sunriseOC: { ...NC_NET, mode: 'openclose', insideBlack: true },
}
const T = (i) => 1_500_000_000 + i * 86_400
/** `n` candles with inside bars, explicit (gold) colours, and `ws` whitespace slots at the end (the load reserve). */
function candles(n, ws = 3) {
  const out = []
  for (let i = 0; i < n; i++) {
    const base = 100 + Math.sin(i / 11) * 8
    const inside = i % 9 === 4                                // inside the bar before it
    const prev = out[i - 1]
    const h = inside && prev ? prev.high - 0.1 : base + 1 + (i % 4) / 3
    const l = inside && prev ? prev.low + 0.1 : base - 1 - (i % 3) / 4
    const c = l + (h - l) * (((i * 37) % 10) / 10)
    const o = l + (h - l) * (((i * 53) % 10) / 10)
    const row = { time: T(i), open: o, high: h, low: l, close: c }
    if (i % 500 === 251) row.color = '#e6b800'                // a gold highlight: an explicit colour, kept (OFF the window grid)
    out.push(row)
  }
  for (let k = 0; k < ws; k++) out.push({ time: T(n + k) })
  return out
}
const ODD = [null, { time: T(0) }, { time: T(1), open: 1, high: 2, low: 0.5 }, { time: T(2), open: 1, high: 2, low: 0.5, close: 1.5 },
  { time: T(3), open: 1.6, high: 1.9, low: 0.6, close: 1.2 }, { time: T(4), open: 1.2, high: 1.8, low: 0.9, close: 1.7, color: '#123456' },
  { time: T(5), close: 1.1 }, { time: T(6), open: 1, high: 1.7, low: 0.95, close: 1.65 }, { time: T(7) }]
const fakeSeries = () => ({ got: [], upd: [], setData(d) { this.got.push(d) }, update(b) { this.upd.push(b) } })
const mkRefs = () => ({ netPrevCloseRef: { current: 'x' }, lastNetCloseRef: { current: 'x' }, netPrevBarRef: { current: 'x' }, lastNetBarRef: { current: 'x' }, lastNetTimeRef: { current: 'x' } })
const refsNow = (R) => ({ netPrevClose: R.netPrevCloseRef.current, lastNetClose: R.lastNetCloseRef.current, netPrevBar: R.netPrevBarRef.current, lastNetBar: R.lastNetBarRef.current, lastNetTime: R.lastNetTimeRef.current })

describe('C1 the series receives what it did before, on every colour mode', () => {
  for (const [name, NC] of Object.entries(MODES)) {
    it(`${name}: setData, the refs, and live updates after it`, () => {
      for (const data of [candles(1200), ODD, [], candles(5, 0)]) {
        const s = fakeSeries()
        const R = mkRefs()
        installNetChangePaint(s, () => NC, R)
        s.setData(data)
        const want = refSetData(data, NC)
        expect(s.got[0]).toEqual(want.painted)
        for (let i = 0; i < data.length; i++) if (want.painted[i] === data[i]) expect(s.got[0][i]).toBe(data[i])   // kept rows are the SAME rows
        expect(refsNow(R)).toEqual(want.refs)
        if (!data.length) continue
        // live: a new bar, then the same bar again, then a whitespace-free tick
        const lastT = data[data.length - 1]?.time ?? T(0)
        let r = want.refs
        for (const bar of [{ time: lastT + 86_400, open: 101, high: 104, low: 99, close: 103 }, { time: lastT + 86_400, open: 101, high: 105, low: 98, close: 99 }]) {
          s.update(bar)
          const u = refUpdate(bar, r, NC)
          r = u.r
          expect(s.upd[s.upd.length - 1]).toEqual(u.out)
          expect(refsNow(R)).toEqual(r)
        }
      }
    })
  }
  it('a value that is not an array passes through untouched', () => {
    const s = fakeSeries()
    installNetChangePaint(s, () => NC_NET, mkRefs())
    const v = { not: 'an array' }
    s.setData(v)
    expect(s.got[0]).toBe(v)
  })
})

// ── the real renderer, through the render window (windowedChart.realLwc.test.js's harness) ──────────────────────────
beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 900, height: 500 }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 900 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 500 }, configurable: true })
})
beforeEach(() => { localStorage.removeItem(RENDER_WINDOW_OFF_KEY) })
const frame = () => new Promise((r) => setTimeout(r, 60))

const N = 8000
/** A board whose candle series records every array the LIBRARY is handed (the raw series' setData). */
function board(NC, readNC = null, barColours = null) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const raw = createChart(el, { width: 900, height: 500, timeScale: { rightOffset: 8 } })
  const handed = []
  const add = raw.addSeries.bind(raw)
  raw.addSeries = (...a) => {
    const s = add(...a)
    const set = s.setData.bind(s)
    s.setData = (d) => { handed.push(d); return set(d) }
    return s
  }
  const chart = createWindowedChart(raw)
  const series = chart.addSeries(CandlestickSeries, {})
  chart.window.setPrimary(series)
  let reads = 0
  const counted = new Proxy(NC, { get: (t, k) => { if (k === 'mode') reads += 1; return t[k] } })
  const R = mkRefs()
  installNetChangePaint(series, readNC || (() => counted), R)
  // as StockChart installs them: the net wrap first, then Pine `barcolor` (so barcolor's colours reach the net wrap first)
  if (barColours) wrapSeriesForBarColours(series, () => barColours)
  return { chart, series, handed, R, reads: () => reads, ts: chart.timeScale() }
}

describe('C2 through the render window, the library holds the rows it held before', () => {
  it('after the load, after the window extends left, and after a live update', async () => {
    const data = candles(N)
    const want = refSetData(data, NC_NET)
    const b = board(NC_NET)
    b.chart.window.setWindow(renderWindowRows(150, 0), { span: 150 })
    b.series.setData(data)
    const ws = b.chart.window.windowStart()
    expect(ws).toBeGreaterThan(0)                                // a window (or this proves nothing)
    expect(want.painted[ws]).not.toBe(data[ws])                  // its first row is one the paint colours (or the step back is not tested)
    expect(b.handed[b.handed.length - 1]).toEqual(want.painted.slice(ws))
    expect(refsNow(b.R)).toEqual(want.refs)
    b.ts.setVisibleLogicalRange({ from: 3000, to: 3150 })        // reach left: the window extends
    await frame()
    const ws2 = b.chart.window.windowStart()
    expect(ws2).toBeLessThan(ws)
    expect(want.painted[ws2]).not.toBe(data[ws2])                // likewise the extension's first row
    expect(b.handed[b.handed.length - 1]).toEqual(want.painted.slice(ws2))
    const bar = { time: T(N + 3), open: 101, high: 104, low: 99, close: 103 }
    b.series.update(bar)
    const u = refUpdate(bar, want.refs, NC_NET)
    const appSeen = b.series.data()
    // (the library writes its own `_internal_originalTime` onto the item it is handed: compare the item's own fields)
    expect(appSeen[appSeen.length - 1]).toMatchObject(u.out)    // the live bar, painted as before
  })

  it('with the window off (every bar), the library is handed every painted row, as before', () => {
    localStorage.setItem(RENDER_WINDOW_OFF_KEY, '1')
    const data = candles(1500)
    const b = board(MODES.sunrise)
    b.chart.window.setWindow(renderWindowRows(150, 0), { span: 150 })
    b.series.setData(data)
    expect(b.handed[b.handed.length - 1]).toEqual(refSetData(data, MODES.sunrise).painted)
  })
})

describe('C3 only the window is painted', () => {
  it('the colours are read for about the window\'s bars, and the rows left of it stay as they came', () => {
    const data = candles(N)
    const b = board(NC_NET)
    const rows = renderWindowRows(150, 0)
    b.chart.window.setWindow(rows, { span: 150 })
    b.series.setData(data)
    const ws = b.chart.window.windowStart()
    expect(ws).toBeGreaterThan(0)
    expect(b.reads()).toBeLessThan(4 * (N - ws + 2))           // ~3 reads a painted bar: the window, not 8,000 bars
    expect(b.series.data().length).toBe(N + 3)                  // the app still sees every row ...
    expect(data[1].color).toBeUndefined()                       // (row 1 is one the paint would colour)
    expect(refSetData(data, NC_NET).painted[1].color).toBeDefined()
    expect(b.series.data()[1]).toBe(data[1])                    // ... and the rows left of the window as they came
    expect(b.series.data()[1].color).toBeUndefined()
  })
})

describe('C4 the colours of a setData stay with its rows', () => {
  it("an extension after a colour change paints the rows it adds with the setData's colours", async () => {
    const data = candles(N)
    const want = refSetData(data, NC_NET)
    const holder = { nc: NC_NET }
    const b = board(NC_NET, () => holder.nc)
    b.chart.window.setWindow(renderWindowRows(150, 0), { span: 150 })
    b.series.setData(data)
    const ws = b.chart.window.windowStart()
    holder.nc = { ...NC_NET, up: '#010101', down: '#020202', borUp: '#030303', borDown: '#040404', wickUp: '#050505', wickDown: '#060606' }
    b.ts.setVisibleLogicalRange({ from: 3000, to: 3150 })
    await frame()
    const ws2 = b.chart.window.windowStart()
    expect(ws2).toBeLessThan(ws)                                 // it did extend (or this proves nothing)
    expect(b.handed[b.handed.length - 1]).toEqual(want.painted.slice(ws2))
  })
})

describe('C5 the paint from any row on equals the whole pass from that row on', () => {
  it('every from, every mode, whitespace and null rows before it', () => {
    const fixtures = [ODD, candles(60), [{ time: T(0) }, { time: T(1) }, ...candles(20, 2)]]
    for (const [name, NC] of Object.entries(MODES)) {
      for (const rows of fixtures) {
        const whole = refSetData(rows, NC).painted
        for (let from = 0; from <= rows.length; from++) {
          expect(paintNetFrom(rows, from, () => NC), `${name} from ${from}`).toEqual(whole.slice(from))
        }
      }
    }
  })
})

describe('C6 Pine barcolor through the render window (review of #2632)', () => {
  it("barcolor's explicit colours survive the window's cut and an extension left, as before", async () => {
    const data = candles(N)
    const map = new Map()
    for (const i of [7251, 7400, 7999, 3010, 2600, 100]) map.set(String(T(i)), '#7c3aed')   // in the window, in the extension, left of both
    const want = refSetData(applyBarColours(data, map), NC_NET)   // what the library held: barcolor, then the net paint
    const b = board(NC_NET, null, map)
    b.chart.window.setWindow(renderWindowRows(150, 0), { span: 150 })
    b.series.setData(data)
    const ws = b.chart.window.windowStart()
    expect(ws).toBeLessThan(7251)                                    // a recoloured row is in the window (or this proves nothing)
    const handed = b.handed[b.handed.length - 1]
    expect(handed).toEqual(want.painted.slice(ws))
    expect(handed.find((r) => r.time === T(7400)).color).toBe('#7c3aed')
    b.ts.setVisibleLogicalRange({ from: 3000, to: 3150 })
    await frame()
    const ws2 = b.chart.window.windowStart()
    expect(ws2).toBeLessThan(3010)
    const handed2 = b.handed[b.handed.length - 1]
    expect(handed2).toEqual(want.painted.slice(ws2))
    expect(handed2.find((r) => r.time === T(3010)).color).toBe('#7c3aed')
  })
})
