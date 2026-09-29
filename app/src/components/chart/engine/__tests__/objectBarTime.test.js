// ─── `xloc.bar_time` OBJECTS, PLACED ON A REAL TIME SCALE ─────────────────────
//
// An `xloc.bar_time` coordinate is a Pine time: MILLISECONDS. The painter's
// contract is a time in the SERIES' OWN SHAPE — `timeToX(t)` is
// `timeScale().timeToCoordinate(adjustTime(t))` (StockChart's object-layer
// mapping), and lightweight-charts places only a time it holds a slot for. The
// product's daily series is keyed by `YYYY-MM-DD` and its intraday series by unix
// seconds, so a millisecond count was unplaceable on both: measured below on the
// real library, before and after.
//
// After Q-T1 (daily ISO dates open at 09:30 New York, `barOpenInstant`),
// position-size-calculator reaches the render state with 50 such labels and
// price-action-as-in-book-fibonacci with 7. Both are driven through the member
// door on their own RDDT 1D captures at the end of this file.
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts'
import { toRenderState } from '../objectRenderState'
import { barOpenInstant } from '../../indicators.js'
import * as registry from '../nativeRegistry'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { enterMemberDoor, toProductBars, tfCodeOf, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from './fakeChart'
import { GC_BATCH } from '../objectPool'

/** How many of `n` creates the collector leaves live at `cap` (#247). */
function keptByCollector(n, cap) {
  let live = 0
  for (let i = 0; i < n; i += 1) { live += 1; if (live > cap + GC_BATCH) live = cap }
  return live
}

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 800, height: 400 }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 800 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 400 }, configurable: true })
})
afterEach(() => { registry.uninstallUserDefinition(HARNESS_DEF_ID) })

/** StockChart shifts a NUMERIC time by the ET offset on the way into the chart
 *  and passes a date string through; any constant shows the same thing. */
const ET = -4 * 3600
const adjustTime = (t) => (typeof t === 'number' ? t + ET : t)

/** The next `n` weekdays after an ISO date — StockChart's future whitespace
 *  slots on a daily chart (holidays aside, which these dates do not cross). */
function weekdaysAfter(iso, n) {
  const out = []
  let ms = Date.parse(`${iso}T00:00:00Z`)
  while (out.length < n) {
    ms += 86400000
    const dow = new Date(ms).getUTCDay()
    if (dow !== 0 && dow !== 6) out.push(new Date(ms).toISOString().slice(0, 10))
  }
  return out
}

/** A real chart over `bars` in the product's shape, with future whitespace, and
 *  the object layer's own mapping into it. */
function chartOver(bars, future) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createChart(el, { width: 800, height: 400 })
  chart.addSeries(CandlestickSeries, {}).setData(bars.map((b) => ({
    time: adjustTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c,
  })))
  if (future.length) chart.addSeries(LineSeries, { visible: false }).setData(future.map((t) => ({ time: adjustTime(t) })))
  const ts = chart.timeScale()
  ts.setVisibleLogicalRange({ from: 0, to: bars.length + future.length - 1 })
  return { timeToX: (t) => ts.timeToCoordinate(adjustTime(t)), chart }
}

const label = (x, id = 1) => ({ id, family: 'label', props: { x, y: 10, xloc: 'bar_time', text: 't' } })

const DAILY = weekdaysAfter('2026-08-02', 40).map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i }))
const LAST = DAILY[DAILY.length - 1].t

describe('⭐⭐ a daily series keyed by DATES', () => {
  it('⛔ CONTROL — the raw Pine time is unplaceable on the real time scale', () => {
    const { timeToX } = chartOver(DAILY, weekdaysAfter(LAST, 10))
    const at = barOpenInstant(DAILY[20].t, 'D')
    expect(Number.isFinite(timeToX(DAILY[20].t))).toBe(true)   // the bar itself is on the axis
    expect(timeToX(at * 1000)).toBe(null)                       // …its millisecond time is not
    expect(timeToX(at)).toBe(null)                              // …nor its seconds
  })

  it('a bar_time equal to a bar\'s opening instant lands ON that bar', () => {
    const { timeToX } = chartOver(DAILY, weekdaysAfter(LAST, 10))
    for (const i of [0, 7, 20, DAILY.length - 1]) {
      const rs = toRenderState([label(barOpenInstant(DAILY[i].t, 'D') * 1000)], { bars: DAILY, tf: 'D' })
      expect(rs.labels[0].x, `bar ${i}`).toBe(DAILY[i].t)
      expect(timeToX(rs.labels[0].x)).toBe(timeToX(DAILY[i].t))
    }
  })

  it('a projection past the last bar lands on the future slot for its date', () => {
    const future = weekdaysAfter(LAST, 10)
    const { timeToX } = chartOver(DAILY, future)
    const rs = toRenderState([label(barOpenInstant(future[4], 'D') * 1000)], { bars: DAILY, tf: 'D' })
    expect(rs.labels[0].x).toBe(future[4])
    expect(Number.isFinite(timeToX(rs.labels[0].x))).toBe(true)
  })

  it('⛔ an instant that is not its date\'s session open, or a series with no timeframe, is DROPPED and counted', () => {
    const open = barOpenInstant(DAILY[5].t, 'D')
    for (const [x, tf] of [[(open + 3600) * 1000, 'D'], [(open - 3600) * 1000, 'D'], [open * 1000, undefined]]) {
      const rs = toRenderState([label(x)], { bars: DAILY, tf })
      expect(rs.labels, `x=${x} tf=${tf}`).toHaveLength(0)
      expect(rs.dropped.label).toBe(1)
    }
    // a weekly series keyed the same way has no measured opening instant
    expect(toRenderState([label(open * 1000)], { bars: DAILY, tf: 'W' }).dropped.label).toBe(1)
  })

  it('lines and boxes take the same road', () => {
    const a = barOpenInstant(DAILY[3].t, 'D') * 1000
    const b = barOpenInstant(DAILY[9].t, 'D') * 1000
    const rs = toRenderState([
      { id: 1, family: 'line', props: { x1: a, y1: 1, x2: b, y2: 2, xloc: 'bar_time' } },
      { id: 2, family: 'box', props: { left: b, top: 2, right: a, bottom: 1, xloc: 'bar_time' } },
    ], { bars: DAILY, tf: 'D' })
    expect([rs.lines[0].x1, rs.lines[0].x2]).toEqual([DAILY[3].t, DAILY[9].t])
    expect([rs.boxes[0].left, rs.boxes[0].right]).toEqual([DAILY[3].t, DAILY[9].t])
  })
})

describe('⭐ an intraday series keyed by SECONDS', () => {
  const T0 = 1785249000 // 2026-07-28 09:30 New York
  const HOURLY = Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * 3600, o: 10, h: 11, l: 9, c: 10 }))

  it('⛔ CONTROL — the raw millisecond time is past the last slot; the seconds land on the bar', () => {
    const { timeToX } = chartOver(HOURLY, [])
    expect(timeToX(HOURLY[12].t * 1000)).toBe(null)
    const rs = toRenderState([label(HOURLY[12].t * 1000)], { bars: HOURLY, tf: '60' })
    expect(rs.labels[0].x).toBe(HOURLY[12].t)
    expect(timeToX(rs.labels[0].x)).toBe(timeToX(HOURLY[12].t))
    expect(Number.isFinite(timeToX(rs.labels[0].x))).toBe(true)
  })
})

describe('⭐⭐ the two corpus scripts, through the member door on their own captures', () => {
  const REPO = path.resolve(process.cwd(), '..')
  const renderOf = (file) => {
    const cap = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness', file), 'utf8'))
    const door = enterMemberDoor(cap.source.text)
    expect(door.def, door.refusal).toBeTruthy()
    const bars = toProductBars(cap)
    const tf = tfCodeOf(cap.timeframe)
    const reader = objectReaderFor(door.def, bars, { inputs: undefined, tf, symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
    const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime })
    const held = run.live.filter((o) => o.family === 'label' && o.props.xloc === 'bar_time')
    return { bars, tf, held, state: toRenderState(run.live, { bars, tf }) }
  }

  it('position-size-calculator: its projected labels land on future daily slots', () => {
    const { bars, tf, held, state } = renderOf('position-size-calculator-rddt-1d-2026-09-28.json')
    expect(tf).toBe('D')
    // ⭐ FOUR, as the vendor's capture holds (objects.counts.label = 4): every
    // helper does `label.delete(_lbl)` before `label.new`, and a deleted label is
    // gone (#245/#247). ⚰️ This read 50 when deleted labels still sat in the ring.
    expect(held.length).toBe(4)
    // `time + (time - time[1]) * 30`: thirty times the last bar spacing ahead
    const { timeToX } = chartOver(bars.slice(-60), weekdaysAfter(bars[bars.length - 1].t, 40))
    const placed = state.labels.filter((l) => Number.isFinite(timeToX(l.x)))
    expect(state.labels.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.x))).toBe(true)
    expect(placed.length).toBeGreaterThan(0)
    // ⛔ CONTROL: the same labels' raw coordinates place nowhere
    expect(held.filter((o) => Number.isFinite(timeToX(o.props.x))).length).toBe(0)
  })

  it('⛔ price-action fibonacci: NOT placed, and the render state says so — its x is not a Pine time', () => {
    // `distance_x = timenow + math.round(ta.change(time) * 1)`. `timenow` binds
    // to `lastbartime` in SECONDS while `time` is milliseconds, so the sum is
    // neither unit (1,877,002,200). That is the translator's `timenow`, recorded
    // here so the drop is not mistaken for a render-state defect.
    const { held, state } = renderOf('price-action-as-in-book-fibonacci-supportresistant-trendline-rddt-1d-2026-09-28.json')
    expect(held.length).toBe(7)
    expect(held.every((o) => o.props.x === 1877002200)).toBe(true)
    expect(state.labels).toHaveLength(0)
    expect(state.dropped.label).toBe(7)
  })
})

describe('⭐ the product\'s own route — the binder hands the object layer a placeable time', () => {
  const HOURLY = Array.from({ length: 30 }, (_, i) => ({ t: 1785249000 + i * 3600, o: 10, h: 11, l: 9, c: 10 }))
  const SRC = ['//@version=5', 'indicator("bar time", overlay=true)', 'plot(close)',
    // a bare `time` (the runtime's `readTime`) and a computed one (a graph tree)
    'label.new(time, close, "bare", xloc = xloc.bar_time)',
    'label.new(time + 0, high, "tree", xloc = xloc.bar_time)'].join(String.fromCharCode(10))

  function syncOver(bars, tf) {
    const door = enterMemberDoor(SRC)
    expect(door.def, door.refusal).toBeTruthy()
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings({}), door.def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === door.def.id)
    let state = null
    binder.sync({
      enabled: true, cs, instances, registry, bars, tf,
      symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: false,
      adjustTime, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: {} }),
      createObjectLayer: () => ({ set: (next) => { state = next }, clear: () => {} }),
    })
    binder.teardown()
    expect(state, 'the layer was never handed a state').toBeTruthy()
    return state
  }

  for (const [name, bars, tf] of [['date-keyed daily', DAILY, 'D'], ['seconds-keyed hourly', HOURLY, '60']]) {
    it(`both spellings of \`time\` land on their own bar of a ${name} series`, () => {
      const state = syncOver(bars, tf)
      // Two labels per bar, each at its own bar's key, and the collector's batch
      // rule (#247): past cap + GC_BATCH it cuts back to cap, so 60 creates
      // leave 54, not 50 — the vendor's measured behaviour, id by id.
      const kept = keptByCollector(bars.length * 2, 50)
      expect(state.labels.length).toBe(kept)
      expect(state.dropped.label).toBe(0)
      const want = bars.slice(-kept / 2).flatMap((b) => [b.t, b.t])
      expect(state.labels.map((l) => l.x)).toEqual(want)
      const { timeToX } = chartOver(bars, [])
      expect(state.labels.every((l) => Number.isFinite(timeToX(l.x)))).toBe(true)
    })
  }
})
