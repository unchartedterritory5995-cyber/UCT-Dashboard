// app/src/components/chart/engine/__tests__/markerScaleAndNaBreaks.test.js
//
// ─── BACKLOG ROWS 41 AND 42 (production, AGL daily, 2026-11-17) ────────────────
//
// 41. A 0 or 1 marker output in a pane took part in that pane's scale: a relative
//     strength line of about 0.15 sat flat at the bottom of a pane scaled 0..1 by
//     the new-high flag beside it (a circle `inBar` on a yes/no output).
// 42. A line with bars that have no value was drawn joined across them:
//     `valuewhen(gap, low, 20)` as a dashed step line ran one old level across the
//     chart.
//
// Rails, each mutation-proved (the PR body names the mutants):
//   A. on a REAL lightweight-charts chart driven through the binder, an event
//      glyph in a pane does not move the pane's autoscale range, while an `inBar`
//      glyph on a NUMBER (Pine's `location.absolute`) does — the control;
//   B. for each Pine plot style, `na` handling equals TradingView's (the User
//      Manual's sentences, quoted at `pine.js::PINE_BREAKING_STYLES`): line,
//      stepline and area bridge, linebr and areabr break;
//   C. a definition that asks for breaks (`plots[].sparse`) draws one render series
//      per valued run (no series holds points on both sides of an `na`), and the
//      authored default (no field) is joined: one series, as it drew before.
import { describe, it, expect, beforeAll } from 'vitest'
import * as LWC from 'lightweight-charts'
import { createBinder, eventGlyphHosts } from '../binder'
import { createFakeChart } from './fakeChart'
import { seriesOptionsForPlot, markerIsEvent, AUTOSCALE_EXCLUDE, AUTOSCALE_DEFAULT } from '../pool'
import { translatePine } from '../ast/pine'
import { applyPatch } from '../../builder/authoring/applyPatch'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { isPineImport } from '../definitionSemantics'

// ─── jsdom needs a 2D context and a non-zero layout (as autoscaleOnARealScale) ──
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

const N = 120
const T = (i) => 1_700_000_000 + i * 86_400
const BARS = Array.from({ length: N }, (_, i) => ({ t: T(i), o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1 }))
const CANDLES = BARS.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c }))
// The relative strength line of the repro: about 0.15, never near 1.
const RS = Float64Array.from({ length: N }, (_, i) => 0.15 + 0.01 * Math.sin(i / 7))
const RS_EMA = Float64Array.from({ length: N }, (_, i) => 0.15 + 0.005 * Math.sin(i / 9))
const FLAG = Float64Array.from({ length: N }, (_, i) => (i % 17 === 0 ? 1 : 0))
// A NUMBER column drawn at its value (Pine `plotshape(cond ? x : na, location.absolute)`).
const AT_ONE = Float64Array.from({ length: N }, (_, i) => (i % 17 === 0 ? 1 : NaN))

const NUM_TREE = { type: 'series', name: 'close' }
const BOOL_TREE = { type: 'op', name: '>=', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 1 }] }

/** The repro's shape: an `ast` document with one tree per output, so the binder can
 *  type each output (`outputType`) — the flag's tree is a comparison. */
function rsDef({ marker, flagTree = BOOL_TREE, withLines = true } = {}) {
  const plots = []
  const trees = {}
  if (withLines) {
    plots.push({ key: 'rs', label: 'RS', style: 'line', color: '#2962FF', width: 1, role: 'primary', legend: { decimals: 2 } })
    plots.push({ key: 'rsEma', label: 'EMA', style: 'line', color: '#FF6D00', width: 1, role: 'secondary', legend: { decimals: 2 } })
    trees.rs = NUM_TREE
    trees.rsEma = NUM_TREE
  }
  if (marker) {
    plots.push({ key: 'flag', label: 'Flag', style: 'markers', color: '#2962FF', width: 1, role: 'secondary',
      legend: { decimals: 2 }, marker })
    trees.flag = flagTree
  }
  return { id: 'rs_def', schemaVersion: 1, version: 1, label: 'RS', inputs: [], compute: { kind: 'ast', ast: NUM_TREE, trees }, plots }
}


/** Drive the REAL binder on a REAL chart: candles on pane 0 first (an empty time
 *  scale reads every range `null`, autoscaleOnARealScale.test.js), the definition in
 *  pane 1. Returns pane 1's settled range and the series each glyph layer rides. */
function realPane(def, columns) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = LWC.createChart(el, { width: 800, height: 400 })
  const candles = chart.addSeries(LWC.CandlestickSeries, {})
  candles.setData(CANDLES)
  chart.timeScale().setVisibleLogicalRange({ from: 0, to: N - 1 })
  const layers = []
  const binder = createBinder({ chart, LWC })
  binder.sync({
    enabled: true,
    instances: [{ instanceId: `inst:${def.id}:1`, defId: def.id, inputs: {} }],
    registry: {
      getDefinition: (id) => (id === def.id ? def : null),
      computeFor: () => columns,
      hasAnyFinite: () => true,
      columnKeys: (d) => (d.plots || []).map((p) => p.key),
    },
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 1, scaleId: 'right', scaleOptions: {}, autoscale: 'default' }),
    priceSeries: () => candles,
    createSeriesMarkers: (series, markers) => {
      layers.push({ series })
      return LWC.createSeriesMarkers(series, markers)
    },
  })
  const pane = chart.panes()[1]
  const inPane = pane.getSeries()
  const range = inPane[0].priceScale().getVisibleRange()
  return { range, layers, inPane, candles, chart }
}

const COLS = { rs: RS, rsEma: RS_EMA }

describe('row 41 — an event glyph in a pane does not move the pane\'s scale (real chart)', () => {
  it('baseline: the RS line and its average alone frame about 0.14..0.16', () => {
    const { range } = realPane(rsDef(), COLS)
    expect(range.to).toBeLessThan(0.2)
    expect(range.from).toBeGreaterThan(0.1)
  })

  // ⚠️ "inside the RS band", not "equal to the baseline to 9 places": the glyph layer
  // now rides the RS line, and lightweight-charts' marker primitive adds its own
  // pixel MARGINS for the glyph size. The defect is a range of 0..1; the rail is
  // that the range stays inside the band the lines alone frame.
  it('⭐ the repro: a circle `inBar` on a YES/NO output leaves the range inside the RS band, and rides the RS line', () => {
    const got = realPane(rsDef({ marker: { shape: 'circle', position: 'inBar' } }), { ...COLS, flag: FLAG })
    expect(got.range.to).toBeLessThan(0.2)
    expect(got.range.from).toBeGreaterThan(0.1)
    expect(got.layers).toHaveLength(1)
    expect(got.layers[0].series).toBe(got.inPane[0]) // the RS line, the first line of the pane
  })

  it('⭐ an above-bar glyph does not move it either, and rides the RS line', () => {
    const got = realPane(rsDef({ marker: { shape: 'arrowUp', position: 'aboveBar' }, flagTree: NUM_TREE }), { ...COLS, flag: FLAG })
    expect(got.range.to).toBeLessThan(0.2)
    expect(got.range.from).toBeGreaterThan(0.1)
    expect(got.layers[0].series).toBe(got.inPane[0])
  })

  it('⛔ CONTROL: an `inBar` glyph on a NUMBER (location.absolute) is a price coordinate and DOES widen the range to its value', () => {
    const got = realPane(rsDef({ marker: { shape: 'circle', position: 'inBar' }, flagTree: NUM_TREE }), { ...COLS, flag: AT_ONE })
    expect(got.range.to).toBeGreaterThanOrEqual(1)
    expect(got.layers[0].series).not.toBe(got.inPane[0]) // its own series: the value is the y
  })

  it('a pane of markers only keeps its own series and its own walk (nothing else frames it)', () => {
    const got = realPane(rsDef({ withLines: false, marker: { shape: 'arrowUp', position: 'aboveBar' } }), { flag: FLAG })
    expect(got.layers).toHaveLength(1)
    expect(got.layers[0].series).toBe(got.inPane[0])
    expect(got.range.to).toBeGreaterThanOrEqual(1)
  })
})

// ⭐⭐ COORDINATOR RULING ON #1550 (2026-11-17): FOR A PINE IMPORT, TRADINGVIEW'S SEMANTICS
// WIN. The reference treats plotshape's series as boolean "for all location values except
// location.absolute", so at location.absolute (our `inBar`) TradingView reads the value as the y,
// a yes/no included. The "yes/no inBar glyph is an event that rides the host" rule is for
// AUTHORED (house / member) definitions only. The SAME document, once with its Pine stamps and
// once without, is the pair: only the stamps differ.
describe('ruling on #1550 — Pine absolute bool keeps its y; authored inBar yes/no rides the host', () => {
  const PINE_ABS = [
    '//@version=5',
    'indicator("x")',
    'r = close / 1000',
    'plot(r, "r")',
    'plotshape(close > open, "f", shape.circle, location.absolute)',
    '',
  ].join(String.fromCharCode(10))
  const pineDoc = () => {
    const r = memberPaneDefinition({ id: 'u_pine_abs_bool', name: 'x', source: PINE_ABS })
    expect(r.ok, r.reason).toBe(true)
    return r.definition
  }
  const keysOf = (def) => ({
    line: def.plots.find((p) => p.style === 'line').key,
    mark: def.plots.find((p) => p.style === 'markers').key,
  })

  it('⭐ Pine absolute bool keeps its y: the glyph stays on its own series and its 0/1 widens the range (unchanged from before #1550)', () => {
    const def = pineDoc()
    const k = keysOf(def)
    expect(isPineImport(def)).toBe(true)
    expect(def.plots.find((p) => p.key === k.mark).marker.position).toBe('inBar')
    const got = realPane(def, { [k.line]: RS, [k.mark]: FLAG })
    expect(got.layers).toHaveLength(1)
    expect(got.layers[0].series).not.toBe(got.inPane[0])
    expect(got.range.to).toBeGreaterThanOrEqual(1)
  })

  it('⭐ authored inBar yes/no rides the host: the same document without its Pine stamps leaves the range in the band of the line', () => {
    const def = pineDoc()
    const k = keysOf(def)
    const authored = { ...def, meta: { ...(def.meta || {}) } }
    delete authored.meta.recurrenceOrigin
    delete authored.meta.importedFrom
    expect(isPineImport(authored)).toBe(false)
    const got = realPane(authored, { [k.line]: RS, [k.mark]: FLAG })
    expect(got.layers).toHaveLength(1)
    expect(got.layers[0].series).toBe(got.inPane[0])
    expect(got.range.to).toBeLessThan(0.2)
  })
})

describe('row 41 — the rule, as data', () => {
  const glyph = (position) => ({ key: 'f', style: 'markers', marker: { shape: 'circle', ...(position ? { position } : {}) } })
  it('above / below (and the default position) are events; inBar is a coordinate unless the output is a yes/no', () => {
    expect(markerIsEvent(glyph('aboveBar'), false)).toBe(true)
    expect(markerIsEvent(glyph('belowBar'), false)).toBe(true)
    expect(markerIsEvent(glyph(undefined), false)).toBe(true)
    expect(markerIsEvent(glyph('inBar'), false)).toBe(false)
    expect(markerIsEvent(glyph('inBar'), true)).toBe(true)
  })
  it('a dot plot with no glyph (SAR, plot.style_circles) and a line are plotted values, never events', () => {
    expect(markerIsEvent({ key: 'sar', style: 'markers' }, true)).toBe(false)
    expect(markerIsEvent({ key: 'l', style: 'line' }, true)).toBe(false)
  })
  it('a hosted glyph series is excluded from the walk; an unhosted one keeps placement\'s provider', () => {
    const p = glyph('aboveBar')
    expect(seriesOptionsForPlot(p, { autoscale: 'default', markerOnHost: true }).autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
    expect(seriesOptionsForPlot(p, { autoscale: 'default' }).autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)
  })
  it('the host: price on pane 0, the same instance\'s line on its pane and scale, nothing otherwise', () => {
    const line = { instanceId: 'a', poolKey: 'line', plot: { key: 'l', style: 'line' } }
    const other = { instanceId: 'b', poolKey: 'line', plot: { key: 'o', style: 'line' } }
    const ev = { instanceId: 'a', poolKey: 'line', plot: glyph('belowBar') }
    const at = (paneIndex, scaleId = 'right') => ({ paneIndex, scaleId })
    expect(eventGlyphHosts([line, ev], [at(0), at(0)])).toEqual([null, 'price'])
    expect(eventGlyphHosts([line, ev], [at(1), at(1)])).toEqual([null, 0])
    expect(eventGlyphHosts([other, ev], [at(1), at(1)])).toEqual([null, null])
    expect(eventGlyphHosts([line, ev], [at(1, 'left'), at(1)])).toEqual([null, null])
  })
})

// ─── B. Pine plot styles: na handling equals TradingView's, by style ───────────
const pinePlot = (style) => {
  const t = translatePine(`//@version=5\nindicator("x")\nv = close > open ? close : na\nplot(v, "v", style = ${style})\n`)
  const out = (t.outputs || [])[0]
  return (out && out.presentation) || {}
}

describe('row 42 — each Pine plot style bridges or breaks at na as TradingView draws it', () => {
  // User Manual, plot() `style`: style_line "does draw a line through them by joining the
  // most recent non-na value to the next non-na value"; style_linebr "not joining such
  // gaps"; style_areabr "doesn't bridge over na values"; stepline achieves linebr's
  // effect "only if care is taken to plot no color on na values" (so it bridges).
  const TABLE = [
    ['plot.style_line', 'line', false],
    ['plot.style_linebr', 'line', true],
    ['plot.style_stepline', 'stepline', false],
    ['plot.style_area', 'area', false],
    ['plot.style_areabr', 'area', true],
  ]
  for (const [pine, style, breaks] of TABLE) {
    it(`${pine} -> ${style}, ${breaks ? 'BREAKS' : 'bridges'}`, () => {
      const pres = pinePlot(pine)
      expect(pres.style).toBe(style)
      expect(pres.sparse === true).toBe(breaks)
    })
  }
})

describe('row 42 — the member door carries the break into the saved document', () => {
  const doc = (style) => {
    const r = memberPaneDefinition({ id: 'u_test_linebr', name: 'x',
      source: `//@version=5\nindicator("x")\nv = close > open ? close : na\nplot(v, "v", style = ${style})\n` })
    expect(r.ok, r.reason).toBe(true)
    return r.definition.plots.find((p) => p.style !== 'hlines')
  }
  it('⭐ plot.style_linebr -> plots[].sparse true on the installed document', () => {
    expect(doc('plot.style_linebr').sparse).toBe(true)
  })
  it('plot.style_line -> no sparse (bridges, as TradingView draws it)', () => {
    expect(doc('plot.style_line').sparse).toBeUndefined()
  })
})

// ─── C. A definition's authored break, end to end through the binder ──────────
// gapLow = valuewhen(gap, low, 20): a value for 20 bars after each event, na between.
const GAP_LOW = Float64Array.from({ length: 60 }, (_, i) => ((i >= 5 && i < 12) || (i >= 30 && i < 40) ? 50 + (i >= 30 ? 3 : 0) : NaN))
const gapDef = (sparse) => ({
  id: 'gap', schemaVersion: 1, version: 1, label: 'Gap', inputs: [],
  plots: [{ key: 'gapLow', label: 'Gap low', style: 'stepline', lineStyle: 'dashed', color: '#ff9800', width: 1,
    legend: { decimals: 2 }, ...(sparse === undefined ? {} : { sparse }) }],
})

function fakeBind(def) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const bars = Array.from({ length: 60 }, (_, i) => ({ t: 1700000000 + i * 60, o: 50, h: 51, l: 49, c: 50, v: 1 }))
  binder.sync({
    enabled: true,
    instances: [{ instanceId: 'inst:gap:1', defId: 'gap', inputs: {} }],
    registry: {
      getDefinition: () => def,
      computeFor: () => ({ gapLow: GAP_LOW }),
      hasAnyFinite: () => true,
      columnKeys: (d) => d.plots.map((p) => p.key),
    },
    bars,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: null, autoscale: 'exclude' }),
  })
  const sets = fake.calls.filter((c) => c.method === 'setData').map((c) => c.args[0])
  return { sets }
}

const valuedTimes = (data) => data.filter((p) => Number.isFinite(p.value)).map((p) => p.time)

describe('row 42 — a definition that asks for breaks draws one series per valued run', () => {
  it('⭐ sparse: true — two runs, two series, and no series holds a value on both sides of the na gap', () => {
    const { sets } = fakeBind(gapDef(true))
    expect(sets).toHaveLength(2)
    for (const data of sets) {
      const times = valuedTimes(data)
      const first = times[0]
      const lastT = times[times.length - 1]
      // every valued bar between the first and the last of this series is valued (no gap inside)
      const span = data.filter((p) => p.time >= first && p.time <= lastT)
      expect(span.every((p) => Number.isFinite(p.value))).toBe(true)
    }
    // a NaN bar is whitespace `{time}`, never a value
    const primary = sets[0]
    expect(primary.find((p) => p.time === 1700000000 + 20 * 60)).toEqual({ time: 1700000000 + 20 * 60 })
  })

  it('the authored default (no `sparse`) stays joined: ONE series holding both runs, as it drew before', () => {
    const { sets } = fakeBind(gapDef(undefined))
    expect(sets).toHaveLength(1)
    expect(valuedTimes(sets[0])).toHaveLength(17)
  })
})

describe('row 42 — the conversation can ask for breaks, and the default it writes is joined', () => {
  const env = (rev, ops) => ({ contract: 'uct.authoring.patch/1', baseRevision: rev, ops, assumptions: [] })
  const GATE = { gateCtx: { tf: 'D', symbol: 'AAPL' } }
  const applied = (r) => { expect(r.status, JSON.stringify(r.errors)).toBe('applied'); return r.definition }
  const create = { op: 'create', name: 'Gap', placement: 'price',
    outputs: [{ key: 'gapLow', label: 'Gap low', tree: NUM_TREE }, { key: 'other', label: 'Other', tree: NUM_TREE }] }
  const plotOf = (def) => def.plots.find((p) => p.key === 'gapLow')
  it('a NEW output is written with no `sparse` (joined, the default)', () => {
    const d0 = applied(applyPatch(null, env(0, [create, { op: 'set_style', output: 'gapLow', style: 'stepline' }]), GATE))
    expect(plotOf(d0).sparse).toBeUndefined()
  })
  it('set_style.breaks true writes plots[].sparse; false removes it', () => {
    const d1 = applied(applyPatch(null, env(0, [create, { op: 'set_style', output: 'gapLow', style: 'stepline', breaks: true }]), GATE))
    expect(plotOf(d1).sparse).toBe(true)
    const d2 = applied(applyPatch(d1, env(0, [{ op: 'set_style', output: 'gapLow', breaks: false }]), GATE))
    expect(plotOf(d2).sparse).toBeUndefined()
  })
  it('a histogram has no line to break: breaks on one is refused by name', () => {
    const r = applyPatch(null, env(0, [create, { op: 'set_style', output: 'gapLow', style: 'histogram', breaks: true }]), GATE)
    expect(r.status).toBe('refused')
    expect(r.errors.map((e) => e.code)).toContain('style:breaks-inert')
  })
})
