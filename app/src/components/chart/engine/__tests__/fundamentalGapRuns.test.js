// ⛔⛔ UNKNOWN MUST NOT LOOK LIKE KNOWN — the render seam of a canonical gap.
//
// lightweight-charts 5.2.0 connects the valued rows on either side of whitespace,
// so a fundamental line with a canonical gap was drawn straight across it (TSLA
// EPS held its Jan-2025 value through Q1-Q3 2025 on production, 2026-09-24).
// These rails pin the fix at the SERIES level: no render series may hold values
// on both sides of a gap. The PIXEL proof is `tools/fundamentals_gap_pixels.mjs`.
import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { splitGapRuns, hasFundamentalLineage, isConnectedPool, valueAtFor } from '../gapRuns'
import { _resetFundamentalsForTests, primeFundamentalsCatalog } from '../fundamentalSeries'
import { closeUtcSeconds } from '../fundamentalAsOf'
import { legendChips } from '../readout'

const CATALOG = {
  metrics: [
    { id: 'eps_ttm', name: 'EPS (TTM)', series: 'eps_diluted_ttm', compose: null, inputs: [],
      presentation: 'step', cadence: 'quarterly', unit: 'usd_per_share', fmt: 'usd2', category: 'Financials' },
    { id: 'net_margin', name: 'Net Margin', series: 'net_margin_ttm', compose: null, inputs: [],
      presentation: 'step', cadence: 'quarterly', unit: 'percent', fmt: 'pct1', category: 'Profitability' },
  ],
}

function days(n, start = '2025-01-06') {
  const out = []
  const d = new Date(`${start}T00:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const bars = (n) => days(n).map((t, i) => ({ t, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 }))
// A point public at 17:00 ET on `iso` (after that day's close) is known from the NEXT bar.
const pt = (iso, v, pe) => Object.freeze({ t: closeUtcSeconds(iso) + 3600, v, pe, m: v === null ? 'gap' : 'ytd_roll' })

beforeEach(() => { _resetFundamentalsForTests(); primeFundamentalsCatalog(CATALOG) })

// ─── the segmentation contract ──────────────────────────────────────────────
const P = (vals) => vals.map((v, i) => (v === null ? { time: i } : { time: i, value: v }))
const valuesOf = (run) => run.map((p) => p.value)

describe('splitGapRuns', () => {
  it('⭐⭐ 100 100 GAP GAP 120 120 -> two runs, never one', () => {
    const sp = splitGapRuns(P([100, 100, null, null, 120, 120]))
    expect(sp.count).toBe(2)
    expect(sp.runs.map(valuesOf)).toEqual([[100, 100]])
    expect(sp.primary.map((p) => p.value)).toEqual([undefined, undefined, undefined, undefined, 120, 120])
    expect(sp.primary.map((p) => p.time)).toEqual([0, 1, 2, 3, 4, 5])          // every slot kept
  })

  it('three runs, oldest first; the newest stays on the primary', () => {
    const sp = splitGapRuns(P([1, null, 2, 2, null, null, 3]))
    expect(sp.count).toBe(3)
    expect(sp.runs.map(valuesOf)).toEqual([[1], [2, 2]])
    expect(sp.primary.filter((p) => Number.isFinite(p.value)).map((p) => p.value)).toEqual([3])
  })

  it('⛔ leading / trailing whitespace separates nothing -- the SAME array comes back', () => {
    const pts = P([null, null, 5, 5, 6, null])
    const sp = splitGapRuns(pts)
    expect(sp.count).toBe(1)
    expect(sp.runs).toEqual([])
    expect(sp.primary).toBe(pts)
  })

  it('⭐ CONTINUITY CONTROL: a step series with NO gap is one run however often it steps', () => {
    const pts = P([1, 1, 1, 2, 2, 2, 3, 3, 4])
    expect(splitGapRuns(pts)).toEqual({ primary: pts, runs: [], count: 1 })
  })

  it('an all-whitespace or empty series is zero runs', () => {
    expect(splitGapRuns(P([null, null])).count).toBe(0)
    expect(splitGapRuns([]).count).toBe(0)
    expect(splitGapRuns(null).count).toBe(0)
  })

  it('⛔⛔ INVARIANT: no run holds rows from both sides of any gap', () => {
    const vals = [1, 1, null, 2, null, null, 3, 3, 3, null, 4]
    const sp = splitGapRuns(P(vals))
    const all = [...sp.runs, sp.primary.filter((p) => Number.isFinite(p.value))]
    for (const run of all) {
      const idx = run.map((p) => p.time)
      for (let k = 1; k < idx.length; k++) expect(idx[k]).toBe(idx[k - 1] + 1)
    }
    expect(all.reduce((n, r) => n + r.length, 0)).toBe(vals.filter((v) => v !== null).length)
  })

  it('valueAt: a number on a run, NaN on a gap, undefined off the series', () => {
    const at = valueAtFor(P([7, null, 9]))
    expect(at(0)).toBe(7)
    expect(Number.isNaN(at(1))).toBe(true)
    expect(at(99)).toBe(undefined)
  })
})

describe('whose NaNs are canonical gaps', () => {
  const insts = [
    { instanceId: 'f', defId: 'dataSeries', inputs: { source: 'fund:eps_ttm' } },
    { instanceId: 'ma', defId: 'movingAverage', inputs: { source: '@f::value', period: 3 } },
    { instanceId: 'ma2', defId: 'movingAverage', inputs: { source: '@ma::ma', period: 3 } },
    { instanceId: 'rsi', defId: 'rsi', inputs: { source: '@f::value' } },
    { instanceId: 'px', defId: 'movingAverage', inputs: { source: 'close', period: 20 } },
    { instanceId: 'qqq', defId: 'dataSeries', inputs: { source: 'sym:QQQ:close' } },
  ]
  const of = (id) => hasFundamentalLineage(insts.find((i) => i.instanceId === id), insts)

  it('⭐ a fundamental, an MA of it, an MA of that MA, and ANY definition over it', () => {
    expect(of('f')).toBe(true)
    expect(of('ma')).toBe(true)
    expect(of('ma2')).toBe(true)
    expect(of('rsi')).toBe(true)
  })

  it('⛔ price indicators and symbol panes keep today\'s behaviour', () => {
    expect(of('px')).toBe(false)
    expect(of('qqq')).toBe(false)
  })

  it('only connected lines can bridge; histogram bars never do', () => {
    expect(isConnectedPool('line')).toBe(true)
    expect(isConnectedPool('area')).toBe(true)
    expect(isConnectedPool('histogram')).toBe(false)
    expect(isConnectedPool('candlestick')).toBe(false)
  })
})

// ─── through the REAL binder ────────────────────────────────────────────────
function harness() {
  const created = []
  const removed = []
  const moved = []
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const series = {
        __data: [], ctor, options: { ...options }, paneIndex, __alive: true,
        setData: (d) => { series.__data = d; series.__setDataCalls = (series.__setDataCalls || 0) + 1 },
        update: (p) => { series.__data = [...series.__data.slice(0, -1), p] },
        applyOptions: (o) => Object.assign(series.options, o),
        moveToPane: (i) => { series.paneIndex = i; moved.push(series) },
        priceScale: () => ({ applyOptions: () => {} }),
        createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
        data: () => series.__data,
      }
      created.push(series)
      return series
    },
    removeSeries: (s) => { s.__alive = false; removed.push(s) },
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = { LineSeries: 'LineSeries', HistogramSeries: 'HistogramSeries', CandlestickSeries: 'CandlestickSeries',
    BarSeries: 'BarSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 }, LineType: { Simple: 0, WithSteps: 1 } }
  const alive = () => created.filter((s) => s.__alive)
  return { chart, LWC, created, removed, moved, alive }
}

const B = bars(40)                                  // 2025-01-06 .. 2025-02-28
// valid run -> canonical GAP (from 01-20) -> valid again (from 02-10)
const GAPPED = { series: { eps_diluted_ttm: [
  pt('2025-01-02', 2.04, '2024-12-31'),
  pt('2025-01-17', null, '2025-03-31'),
  pt('2025-02-07', 1.08, '2025-12-31'),
] } }
const CONTINUOUS = { series: { eps_diluted_ttm: [
  pt('2025-01-02', 2.04, '2024-12-31'),
  pt('2025-01-17', 2.10, '2025-03-31'),
  pt('2025-02-07', 2.20, '2025-06-30'),
] } }

const F = (extra = {}) => ({ instanceId: 'f', defId: 'dataSeries', inputs: { source: 'fund:eps_ttm' }, hidden: false, ...extra })
const MA = (extra = {}) => ({ instanceId: 'ma', defId: 'movingAverage', inputs: { source: '@f::value', period: 3, maType: 'sma' }, hidden: false, ...extra })

const ADJ = (t) => t                    // StockChart's `adjustTime` is a stable useCallback

function mk(h) {
  const binder = createBinder({ chart: h.chart, LWC: h.LWC })
  const sync = (instances, fundamentals, extra = {}) => binder.sync({
    enabled: true, registry, instances, bars: B, cs: { indicatorInstances: instances },
    sym: 'TSLA', tf: 'D', fundamentals, adjustTime: ADJ,
    resolvePlacement: (inst) => ({ paneIndex: extra.pane?.[inst.instanceId] ?? 1, priceScaleId: 'right', key: 'p' }),
    ...extra,
  })
  return { binder, sync }
}

/** Every alive series' valued times must be one contiguous block of bars. */
function assertNoSeriesSpansAGap(h) {
  const index = new Map(B.map((b, i) => [b.t, i]))
  for (const s of h.alive()) {
    const idx = s.__data.filter((p) => Number.isFinite(p.value)).map((p) => index.get(p.time))
    for (let k = 1; k < idx.length; k++) expect(idx[k], `series ${h.created.indexOf(s)}`).toBe(idx[k - 1] + 1)
  }
}
const valuedDays = (s) => s.__data.filter((p) => Number.isFinite(p.value)).map((p) => p.time)

describe('the binder draws ONE logical line as one render series per run', () => {
  it('⭐⭐ TSLA-shaped: a canonical gap splits the line; nothing spans it', () => {
    const h = harness()
    const { binder, sync } = mk(h)
    sync([F()], new Map([['TSLA', GAPPED]]))
    expect(h.alive()).toHaveLength(2)                        // primary + one earlier run
    assertNoSeriesSpansAGap(h)
    const [primary, run] = h.alive()
    expect(valuedDays(run)[0]).toBe('2025-01-06')
    expect(valuedDays(run).at(-1)).toBe('2025-01-17')        // the last day before the gap
    expect(valuedDays(primary)[0]).toBe('2025-02-10')        // the first day after it
    // the gap itself is valued NOWHERE
    for (const s of h.alive()) expect(valuedDays(s).some((d) => d > '2025-01-17' && d < '2025-02-10')).toBe(false)
    // ONE binding, ONE legend identity
    expect(binder.bindings()).toHaveLength(1)
    expect(binder.bindings()[0].runSeries).toHaveLength(1)
    // the run never writes on the axis; the logical line's tag stays on the primary
    expect(run.options.lastValueVisible).toBe(false)
    expect(run.options.priceLineVisible).toBe(false)
  })

  it('⭐ CONTINUITY CONTROL: no gap -> exactly one series, identical to before', () => {
    const h = harness()
    const { binder, sync } = mk(h)
    sync([F()], new Map([['TSLA', CONTINUOUS]]))
    expect(h.alive()).toHaveLength(1)
    expect(binder.bindings()[0].runSeries).toEqual([])
    const vals = h.alive()[0].__data.map((p) => p.value).filter(Number.isFinite)
    expect(new Set(vals)).toEqual(new Set([2.04, 2.10, 2.20]))
    expect(vals.length).toBe(B.length)                       // every bar valued: continuous steps
  })

  it('⭐⭐ MA of a fundamental: resets at the gap and is drawn broken too', () => {
    const h = harness()
    const { binder, sync } = mk(h)
    sync([F(), MA()], new Map([['TSLA', GAPPED]]))
    assertNoSeriesSpansAGap(h)
    const ma = binder.bindings().find((b) => b.instanceId === 'ma')
    expect(ma.runSeries).toHaveLength(1)
    const primaryVals = ma.series.__data
    const firstAfter = primaryVals.findIndex((p) => p.time === '2025-02-10')
    // a 3-period SMA needs 3 fresh bars after the gap: no state leaks across
    expect(Number.isFinite(primaryVals[firstAfter].value)).toBe(false)
    expect(Number.isFinite(primaryVals[firstAfter + 1].value)).toBe(false)
    expect(primaryVals[firstAfter + 2].value).toBeCloseTo(1.08, 10)
  })

  it('⭐ refresh: the gap closing removes the run; reopening re-creates it', () => {
    const h = harness()
    const { binder, sync } = mk(h)
    sync([F()], new Map([['TSLA', GAPPED]]))
    const run = binder.bindings()[0].runSeries[0]
    sync([F()], new Map([['TSLA', CONTINUOUS]]))
    expect(run.__alive).toBe(false)
    expect(h.alive()).toHaveLength(1)
    sync([F()], new Map([['TSLA', GAPPED]]))
    expect(h.alive()).toHaveLength(2)
    assertNoSeriesSpansAGap(h)
  })

  it('⭐ an unchanged line re-uses its runs without re-sending their data', () => {
    const h = harness()
    const { binder, sync } = mk(h)
    const f = new Map([['TSLA', GAPPED]])
    const insts = [F()]
    sync(insts, f)
    const run = binder.bindings()[0].runSeries[0]
    const calls = run.__setDataCalls
    sync(insts, f)
    expect(binder.bindings()[0].runSeries[0]).toBe(run)
    expect(run.__setDataCalls).toBe(calls)
    expect(h.alive()).toHaveLength(2)
  })

  it('⛔ DELETE: removing the indicator removes the primary AND every run', () => {
    const h = harness()
    const { sync } = mk(h)
    sync([F()], new Map([['TSLA', GAPPED]]))
    expect(h.alive()).toHaveLength(2)
    sync([], new Map([['TSLA', GAPPED]]))
    expect(h.alive()).toHaveLength(0)
  })

  it('⛔ HIDE: a hidden instance leaves no run behind', () => {
    const h = harness()
    const { sync } = mk(h)
    sync([F()], new Map([['TSLA', GAPPED]]))
    sync([F({ hidden: true })], new Map([['TSLA', GAPPED]]))
    expect(h.alive()).toHaveLength(0)
  })

  it('⛔ SYMBOL SWITCH: the new symbol\'s line never inherits the old symbol\'s runs', () => {
    const h = harness()
    const { binder, sync } = mk(h)
    sync([F()], new Map([['TSLA', GAPPED]]))
    const oldRun = binder.bindings()[0].runSeries[0]
    binder.sync({ enabled: true, registry, instances: [F()], bars: B, cs: {}, sym: 'AAPL', tf: 'D',
      fundamentals: new Map([['AAPL', CONTINUOUS]]), adjustTime: (t) => t,
      resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }) })
    expect(oldRun.__alive).toBe(false)
    expect(h.alive()).toHaveLength(1)
    // ... and a symbol with no data at all leaves nothing
    binder.sync({ enabled: true, registry, instances: [F()], bars: B, cs: {}, sym: 'ZZZ', tf: 'D',
      fundamentals: new Map(), adjustTime: (t) => t,
      resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }) })
    expect(h.alive().filter((s) => s.__data.some((p) => Number.isFinite(p.value)))).toHaveLength(0)
  })

  it('⛔ TEARDOWN (unmount / layout change) removes every run', () => {
    const h = harness()
    const { binder, sync } = mk(h)
    sync([F(), MA()], new Map([['TSLA', GAPPED]]))
    expect(h.alive().length).toBeGreaterThanOrEqual(4)
    binder.teardown()
    expect(h.alive()).toHaveLength(0)
  })

  it('⭐ PANE MOVE: every run follows the logical line to its new pane', () => {
    const h = harness()
    const { binder, sync } = mk(h)
    sync([F()], new Map([['TSLA', GAPPED]]))
    sync([F()], new Map([['TSLA', GAPPED]]), { pane: { f: 3 } })
    const b = binder.bindings()[0]
    expect(b.series.paneIndex).toBe(3)
    expect(b.runSeries.map((s) => s.paneIndex)).toEqual([3])
  })

  it('⭐ STYLE: a colour / width / visibility change reaches every run atomically', () => {
    const h = harness()
    const { binder, sync } = mk(h)
    sync([F()], new Map([['TSLA', GAPPED]]))
    sync([F({ inputs: { source: 'fund:eps_ttm', color: '#ff00aa', lineWidth: 3 } })], new Map([['TSLA', GAPPED]]))
    const b = binder.bindings()[0]
    for (const s of [b.series, ...b.runSeries]) {
      expect(s.options.color).toBe(b.series.options.color)
      expect(s.options.lineWidth).toBe(b.series.options.lineWidth)
      expect(s.options.lineType).toBe(b.series.options.lineType)
    }
    sync([F({ inputs: { source: 'fund:eps_ttm', color: '#ff00aa', lineWidth: 3 } })], new Map([['TSLA', GAPPED]]),
      { indicatorsHidden: true })
    for (const s of [b.series, ...binder.bindings()[0].runSeries]) expect(s.options.visible).toBe(false)
  })

  it('⛔ nothing render-only reaches a persisted instance', () => {
    const h = harness()
    const { sync } = mk(h)
    const inst = F()
    const before = JSON.stringify(inst)
    sync([inst], new Map([['TSLA', GAPPED]]))
    expect(JSON.stringify(inst)).toBe(before)
  })
})

describe('the legend reads ONE logical line across its runs', () => {
  const setup = () => {
    const h = harness()
    const { binder, sync } = mk(h)
    sync([F()], new Map([['TSLA', GAPPED]]))
    return { h, binder, insts: [F()] }
  }
  const hover = (h, time) => new Map([[{ candles: true }, { time, open: 1, high: 1, low: 1, close: 1 }]])
  const chipFor = (chips) => chips.find((c) => c.instanceId === 'f')

  it('⭐ hovering the EARLIER run prints that run\'s value, not today\'s', () => {
    const { h, binder, insts } = setup()
    const c = chipFor(legendChips(binder.bindings(), hover(h, '2025-01-10'), registry, insts))
    expect(c.value).toBe(2.04)
  })

  it('⛔⛔ hovering the GAP prints NO value -- never the last known one', () => {
    const { h, binder, insts } = setup()
    const chips = legendChips(binder.bindings(), hover(h, '2025-01-28'), registry, insts)
    const c = chipFor(chips)
    expect(c).toBeTruthy()                                   // the row stays: ONE legend entry
    expect(c.value).toBe(null)
    expect(chips.filter((x) => x.instanceId === 'f')).toHaveLength(1)
  })

  it('at rest it reads the newest bar; a bar the line has no row for keeps the fallback', () => {
    const { h, binder, insts } = setup()
    expect(chipFor(legendChips(binder.bindings(), null, registry, insts)).value).toBe(1.08)
    expect(chipFor(legendChips(binder.bindings(), hover(h, '2099-01-01'), registry, insts)).value).toBe(1.08)
  })
})
