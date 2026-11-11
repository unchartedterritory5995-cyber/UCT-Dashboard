// app/src/components/chart/engine/__tests__/placement.ownScale.test.js
//
// ─── UCT RS Phase 3, unit 3-07 · ON PRICE, ON ITS OWN SCALE ─────────────────
//
// `placement.ownScale: true` (map §1.6 F29, decision D3). On the price pane a
// definition that declares it is drawn on an INVISIBLE OVERLAY SCALE of the
// instance's own, framed in the lowest third under the bars, instead of on the
// candles' axis where a ratio near 0.25 is invisible.
//
// What is pinned here:
//   1. the answer shape, for both ways an instance reaches the price pane (its
//      own stored target, the definition's target) and through `targetOf`;
//   2. two instances get two scale ids; the answer is rebuilt per call;
//   3. a definition WITHOUT `ownScale` is byte-identical, for every definition in
//      the registry, on every target; a non-boolean `ownScale` is no opt-in;
//   4. on a REAL lightweight-charts chart (the `autoscaleOnARealScale` precedent):
//      the candles' visible range is unchanged with the overlay present, and the
//      line lands inside the lowest third of the pane;
//   5. through the BINDER on a recording chart: the series is bound (the
//      price-pane fill skip does not drop it), on its own scale, with no value tag,
//      and nothing is written to the candles' scale;
//   6. `defSchema` admits only a boolean.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createChart, LineSeries, CandlestickSeries } from 'lightweight-charts'
import {
  resolvePlacement, applyAxisTenancy, ownScaleOf, OWN_SCALE_PREFIX, OWN_SCALE_MARGINS, MAIN_PRICE_SCALE_ID,
} from '../placement'
import { seriesOptionsForPlot, AUTOSCALE_DEFAULT } from '../pool'
import { createBinder } from '../binder'
import { createFakeChart, makeBars } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from '../paneLayout'
import { validateDefinition } from '../defSchema'
import * as nativeRegistry from '../nativeRegistry'

const ATR = nativeRegistry.getDefinition('atr')
const RS = nativeRegistry.getDefinition('rsLine')
/** A client-computed pane indicator with the field added, so the binder has a
 *  column to draw without a server lane. It stands in for `rsLine` (3-08). */
const ATR_OWN = { ...ATR, placement: { ...ATR.placement, ownScale: true } }
const RS_OWN = { ...RS, placement: { ...RS.placement, ownScale: true } }

const inst = (defId, extra = {}) => ({ instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra })
const onPrice = (defId, extra = {}) => inst(defId, { placement: { target: 'price' }, ...extra })

const EXPECTED = (key, paneIndex = 0) => ({
  paneIndex,
  scaleId: `own:${key}`,
  scaleOptions: { visible: false, borderVisible: false, scaleMargins: { top: 0.62, bottom: 0.04 } },
  autoscale: 'default',
  lastValue: false,
})

beforeEach(() => { __setPaneModeForTest('panes') })
afterEach(() => { __setPaneModeForTest(null) })

describe('the answer', () => {
  it('an instance moved to the price pane gets its own invisible scale in the lowest third', () => {
    expect(resolvePlacement(onPrice('rsLine', { instanceId: 'rsLine:1' }), RS_OWN, {})).toEqual(EXPECTED('rsLine:1'))
    expect(OWN_SCALE_PREFIX).toBe('own:')
    expect(OWN_SCALE_MARGINS).toEqual({ top: 0.62, bottom: 0.04 })
  })

  it('a definition whose own target is price answers the same', () => {
    const def = { ...RS_OWN, placement: { ...RS_OWN.placement, target: 'price' } }
    expect(resolvePlacement(inst('rsLine', { instanceId: 'rsLine:7' }), def, {})).toEqual(EXPECTED('rsLine:7'))
  })

  it('and when the price target comes from `targetOf` (displayTarget)', () => {
    const ctx = { targetOf: () => 'price' }
    expect(resolvePlacement(inst('rsLine', { instanceId: 'rsLine:2' }), RS_OWN, ctx)).toEqual(EXPECTED('rsLine:2'))
  })

  it('the candles\' pane wherever the layout put it (the Model Book hoists an index above them)', () => {
    const ctx = { paneLayout: { priceIndex: 1, panes: [] } }
    expect(resolvePlacement(onPrice('rsLine', { instanceId: 'rsLine:3' }), RS_OWN, ctx)).toEqual(EXPECTED('rsLine:3', 1))
  })

  it('two instances get two scale ids (two benchmarks are two ladders)', () => {
    const a = resolvePlacement(onPrice('rsLine', { instanceId: 'rsLine:a' }), RS_OWN, {})
    const b = resolvePlacement(onPrice('rsLine', { instanceId: 'rsLine:b' }), RS_OWN, {})
    expect(a.scaleId).toBe('own:rsLine:a')
    expect(b.scaleId).toBe('own:rsLine:b')
    expect(a.scaleId).not.toBe(MAIN_PRICE_SCALE_ID)
  })

  it('an instance with no id is keyed by the definition; the answer is rebuilt per call', () => {
    const first = resolvePlacement({ placement: { target: 'price' } }, RS_OWN, {})
    expect(first.scaleId).toBe('own:rsLine')
    first.scaleOptions.scaleMargins.top = 0
    first.scaleOptions.visible = true
    const second = resolvePlacement({ placement: { target: 'price' } }, RS_OWN, {})
    expect(second.scaleOptions).toEqual(EXPECTED('x').scaleOptions)
  })

  it('the pane target is untouched by the field (D3: the pane stays the default)', () => {
    const layout = computePaneLayout([inst('rsLine')], { chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX })
    const ctx = { paneLayout: layout }
    expect(resolvePlacement(inst('rsLine'), RS_OWN, ctx)).toEqual(resolvePlacement(inst('rsLine'), RS, ctx))
    expect(resolvePlacement(inst('rsLine'), RS_OWN, ctx).scaleId).not.toMatch(/^own:/)
  })

  it('an economic primary keeps the candles\' scale (it IS what that scale is for)', () => {
    const econ = { instanceId: 'econp:FEDFUNDS', placement: { target: 'price' } }
    expect(resolvePlacement(econ, RS_OWN, {}).scaleId).toBe(MAIN_PRICE_SCALE_ID)
  })

  it('applyAxisTenancy leaves the own-scale answer as the SAME object', () => {
    const a = resolvePlacement(onPrice('rsLine', { instanceId: 'rsLine:1' }), RS_OWN, {})
    expect(applyAxisTenancy([a], {})[0]).toBe(a)
  })
})

describe('byte-identical without the field', () => {
  it('every registry definition on every target answers exactly as before', () => {
    const layoutFor = (i) => computePaneLayout([i], { chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX })
    let checked = 0
    // ⭐ 3-08: UCT RS is the one shipped definition that opts in; every other one
    // must not. The comparison runs on each definition WITHOUT the field, so the
    // control holds for UCT RS too.
    expect(nativeRegistry.listDefinitions().filter(ownScaleOf).map((d) => d.id)).toEqual(['rsLine'])
    for (const shipped of nativeRegistry.listDefinitions()) {
      const { ownScale: _drop, ...placement } = shipped.placement || {}
      const def = { ...shipped, placement }
      expect(ownScaleOf(def), def.id).toBe(false)
      for (const target of ['price', 'pane', 'volume']) {
        const i = inst(def.id, { placement: { target } })
        const ctx = { paneLayout: layoutFor(i), volSeparatePane: true, VOL_PANE_INDEX: 1 }
        const before = resolvePlacement(i, def, ctx)
        // the opt-in moves the PRICE answer only; the pane and the volume band are untouched
        if (shipped !== def && ownScaleOf(shipped) && target !== 'price') {
          expect(resolvePlacement(i, shipped, ctx), `${def.id} ${target} with ownScale`).toEqual(before)
        }
        // explicitly absent, false, and a non-boolean: none of them opts in
        for (const v of [undefined, false, 'true', 1]) {
          const d = { ...def, placement: { ...def.placement, ownScale: v } }
          expect(resolvePlacement(i, d, ctx), `${def.id} ${target} ownScale=${String(v)}`).toEqual(before)
        }
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(30)
  })

  it('the price answer for a definition without the field is still the candles\' scale, excluded', () => {
    expect(resolvePlacement(onPrice('atr'), ATR, {})).toEqual({
      paneIndex: 0, scaleId: MAIN_PRICE_SCALE_ID, scaleOptions: null, autoscale: 'exclude',
    })
  })
})

describe('defSchema: placement.ownScale', () => {
  it('admits true and false, refuses anything else', () => {
    for (const v of [true, false]) {
      const r = validateDefinition({ ...RS, placement: { ...RS.placement, ownScale: v } })
      expect(r.ok, r.errors && r.errors.join('\n')).toBe(true)
    }
    for (const v of ['true', 1, null, {}]) {
      const r = validateDefinition({ ...RS, placement: { ...RS.placement, ownScale: v } })
      expect(r.ok, String(v)).toBe(false)
      expect(r.errors.join('\n')).toMatch(/placement\.ownScale: expected a boolean/)
    }
  })
})

// ─── a REAL chart: the candles are untouched, the line sits under the bars ──

describe('on a real lightweight-charts chart', () => {
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
  afterAll(() => {})

  const T = (i) => 1_700_000_000 + i * 86_400
  const CANDLES = Array.from({ length: 120 }, (_, i) => ({ time: T(i), open: 150 + i, high: 152 + i, low: 149 + i, close: 151 + i }))
  /** An RS-ratio-shaped column: ~0.25, the value F29 says vanishes on a $150 axis. */
  const RATIO = Array.from({ length: 120 }, (_, i) => ({ time: T(i), value: 0.25 + 0.03 * Math.sin(i / 7) }))
  const PLOT = ATR.plots.find((p) => p.style !== 'hlines')

  /** Production's call order (the precedent file's header): candles first with
   *  data, then addSeries with the pool's options, then the placement's scale
   *  options, then the indicator's data. */
  function build(withOverlay, placement) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const chart = createChart(el, { width: 800, height: 400 })
    const candles = chart.addSeries(CandlestickSeries, {})
    candles.setData(CANDLES)
    chart.timeScale().setVisibleLogicalRange({ from: 0, to: CANDLES.length - 1 })
    let line = null
    if (withOverlay) {
      const options = seriesOptionsForPlot(PLOT, {
        scaleId: placement.scaleId, autoscale: placement.autoscale, lastValue: placement.lastValue,
      })
      line = chart.addSeries(LineSeries, options)
      if (placement.scaleOptions) line.priceScale().applyOptions(placement.scaleOptions)
      line.setData(RATIO)
    }
    return { chart, candles, line }
  }

  it('the candles\' visible range is the same with the overlay as without it', () => {
    const own = resolvePlacement(onPrice('atr', { instanceId: 'atr:1' }), ATR_OWN, {})
    const alone = build(false).candles.priceScale().getVisibleRange()
    const beside = build(true, own)
    expect(alone).not.toBeNull()
    expect(beside.candles.priceScale().getVisibleRange()).toEqual(alone)
    // and the candles' own scale was never written: its margins are the library's
    expect(beside.candles.priceScale().options().scaleMargins).toEqual(build(false).candles.priceScale().options().scaleMargins)
    expect(beside.line.options().priceScaleId).toBe('own:atr:1')
    expect(beside.line.options().autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)
    expect(beside.line.options().lastValueVisible).toBe(false)
    expect(beside.line.priceScale().options().visible).toBe(false)
  })

  it('the line lands inside the lowest third of the pane', () => {
    const own = resolvePlacement(onPrice('atr', { instanceId: 'atr:1' }), ATR_OWN, {})
    const { chart, line } = build(true, own)
    const h = chart.panes()[0].getHeight()
    expect(h).toBeGreaterThan(100)
    const ys = RATIO.map((p) => line.priceToCoordinate(p.value))
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    // top margin 0.62, bottom margin 0.04 (a pixel of rounding either side)
    expect(top).toBeGreaterThanOrEqual(0.62 * h - 1)
    expect(bottom).toBeLessThanOrEqual((1 - 0.04) * h + 1)
    // non-vacuity: the line spans its band rather than collapsing to a point
    expect(bottom - top).toBeGreaterThan(0.25 * h)
  })

  it('CONTROL: the same line on the candles\' scale is the F29 failure (it reframes or vanishes)', () => {
    const shared = resolvePlacement(onPrice('atr'), ATR, {})
    const { candles, line } = build(true, shared)
    // excluded from the candles' range, a 0.25 is far below a $150 axis: off the pane
    expect(candles.priceScale().getVisibleRange().from).toBeGreaterThan(100)
    const h = 400
    expect(line.priceToCoordinate(0.25)).toBeGreaterThan(h)
  })
})

// ─── through the BINDER: what the renderer is actually told ─────────────────

describe('through the binder (a recording chart)', () => {
  const bars = makeBars()
  const ownRegistry = {
    ...nativeRegistry,
    getDefinition: (id) => (id === 'atr' ? ATR_OWN : nativeRegistry.getDefinition(id)),
  }
  const ctxFor = (instances, registry = ownRegistry) => ({
    enabled: true,
    registry,
    instances,
    bars,
    adjustTime: (t) => t,
    resolvePlacement,
    paneMargins: {},
    paneLayout: computePaneLayout(instances.filter((i) => !(i.placement && i.placement.target === 'price')), {
      chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
    }),
    volOverlaySet: new Set(),
    volSeparatePane: false,
    VOL_PANE_INDEX: 1,
    plan: { fresh: true },
    applyData: (series, data) => { if (series && data) series.setData(data) },
  })

  it('the own-scale series is bound, on its own scale, with no tag, and writes only its own scale', () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const r = binder.sync(ctxFor([onPrice('atr', { instanceId: 'atr:1' })]))
    expect(fake.seriesCreated.length, 'nothing bound: the price-pane path dropped the series').toBeGreaterThan(0)
    expect(r && r.bound).toBeGreaterThan(0)
    for (const s of fake.seriesCreated) {
      expect(s.__options.priceScaleId).toBe('own:atr:1')
      expect(s.__options.lastValueVisible).toBe(false)
    }
    const writes = fake.calls.filter((c) => c.method === 'priceScale.applyOptions').map((c) => c.args[0])
    expect(writes).toEqual([EXPECTED('atr:1').scaleOptions])
    // ⛔ nothing at chart level, and the candles' right scale is never asked
    expect(fake.calls.filter((c) => c.id === 'chart:right')).toEqual([])
    expect(fake.callsOf('applyOptions').filter((c) => c.on === 'chart')).toEqual([])
  })

  it('two instances bind onto two scales', () => {
    const fake = createFakeChart()
    createBinder({ chart: fake.chart, LWC: fake.LWC }).sync(ctxFor([
      onPrice('atr', { instanceId: 'atr:1' }), onPrice('atr', { instanceId: 'atr:2' }),
    ]))
    const ids = new Set(fake.seriesCreated.map((s) => s.__options.priceScaleId))
    expect(ids).toEqual(new Set(['own:atr:1', 'own:atr:2']))
  })

  it('CONTROL: without the field the same instance binds on the candles\' scale, asserting nothing', () => {
    const fake = createFakeChart()
    createBinder({ chart: fake.chart, LWC: fake.LWC }).sync(ctxFor([onPrice('atr', { instanceId: 'atr:1' })], nativeRegistry))
    expect(fake.seriesCreated.length).toBeGreaterThan(0)
    for (const s of fake.seriesCreated) expect(s.__options.priceScaleId).toBe(MAIN_PRICE_SCALE_ID)
    expect(fake.calls.filter((c) => c.method === 'priceScale.applyOptions')).toEqual([])
  })
})
