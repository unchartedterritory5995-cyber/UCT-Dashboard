// app/src/components/chart/engine/__tests__/placement.pinScale.test.js
//
// ─── PIN TO SCALE: "Same as price" / "No scale" (owner, 2026-11-26, Fred RS) ──
//
// "It doesn't scale and move properly ... it gets stuck low on the chart instead of scaling as I
// move price and candles." On the owner's TradingView Fred RS is pinned to "No scale": an overlay
// scale with no axis, autoscaled on the line's own visible values, so it fills the pane and follows
// the visible window as they pan and zoom, independent of the price axis.
//
// What is pinned here:
//   1. placement: "No scale" resolves to `pin:<instanceId>`, invisible, autoscaled, in the candles'
//      band; "Same as price" and every non-Fred default are byte-identical to before;
//   2. the Fred default: an unedited Fred RS copy with nothing stored is "No scale"; a stored
//      "Same as price" wins; an EDITED copy is an ordinary script;
//   3. the series options carry the scale, the own-autoscale provider and no axis tag;
//   4. on a REAL lightweight-charts chart: the candles' range is untouched, the line fills the band,
//      and it re-frames to the VISIBLE window when the window moves;
//   5. through the binder: bound on its own scale, only its own scale written;
//   6. drawn objects map through the instance's scale (`objectPriceHost`), the event-glyph host
//      leaves the candles, and an average pinned off price keeps its own autoscale;
//   7. the writer stores every pick, and the pick survives the instance round trip.

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { createChart, LineSeries, CandlestickSeries } from 'lightweight-charts'
import {
  resolvePlacement, pinScaleOf, defaultPinScaleOf, pinScaleOffered, objectPriceHost, isInstanceScaleId,
  PIN_SCALE_PREFIX, PIN_SCALE_NONE, PIN_SCALE_PRICE, PIN_SCALE_LABELS, MAIN_PRICE_SCALE_ID,
} from '../placement'
import { seriesOptionsForPlot, AUTOSCALE_DEFAULT } from '../pool'
import { createBinder, eventGlyphHosts } from '../binder'
import { createFakeChart, makeBars } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX, NO_STACK_MAIN_MARGINS } from '../paneLayout'
import { eligibleInstances } from '../eligibility'
import { setInstancePinScale } from '../instanceControls'
import { normalizeInstances } from '../instances'
import * as nativeRegistry from '../nativeRegistry'

const ATR = nativeRegistry.getDefinition('atr')
/** A Fred RS member copy as the house tab saves it: a user definition named after the house entry,
 *  script never edited (`houseNames.isHouseCopyMeta`). ATR stands in for its maths so the binder has
 *  a client-computed column to draw. */
const FRED = { ...ATR, id: 'u_fred1', placement: { target: 'price' }, meta: { ...(ATR.meta || {}), name: 'Fred RS' } }
const FRED_EDITED = { ...FRED, meta: { ...FRED.meta, scriptEdited: true } }
const PLAIN = { ...ATR, id: 'u_plain', placement: { target: 'price' }, meta: { ...(ATR.meta || {}), name: 'My script' } }
const OWN = { ...ATR, placement: { target: 'price', ownScale: true } }

const inst = (defId, extra = {}) => ({ instanceId: `${defId}:1`, defId, inputs: {}, hidden: false, ...extra })
const MARGINS = { top: 0.3, bottom: 0.05 }

const EXPECTED = (key, margins = MARGINS) => ({
  paneIndex: 0,
  scaleId: `pin:${key}`,
  scaleOptions: { visible: false, borderVisible: false, autoScale: true, scaleMargins: margins },
  autoscale: 'default',
  lastValue: false,
})
const SHARED = { paneIndex: 0, scaleId: MAIN_PRICE_SCALE_ID, scaleOptions: null, autoscale: 'exclude' }

beforeEach(() => { __setPaneModeForTest('panes') })
afterEach(() => { __setPaneModeForTest(null) })

describe('placement', () => {
  it('"No scale" is an invisible, autoscaled overlay scale of the instance\'s own, in the candles\' band', () => {
    const i = inst('u_plain', { placement: { pinScale: 'none' } })
    expect(resolvePlacement(i, PLAIN, { mainScaleMargins: MARGINS })).toEqual(EXPECTED('u_plain:1'))
    expect(PIN_SCALE_PREFIX).toBe('pin:')
    expect(PIN_SCALE_LABELS).toEqual({ price: 'Same as price', none: 'No scale' })
  })

  it('two instances get two scales (two lines never autoscale together)', () => {
    const a = resolvePlacement(inst('u_plain', { instanceId: 'a', placement: { pinScale: 'none' } }), PLAIN, {})
    const b = resolvePlacement(inst('u_plain', { instanceId: 'b', placement: { pinScale: 'none' } }), PLAIN, {})
    expect([a.scaleId, b.scaleId]).toEqual(['pin:a', 'pin:b'])
  })

  it('margins fall back to the layout\'s band, then the no-stack default; rebuilt per call', () => {
    const i = inst('u_plain', { placement: { pinScale: 'none' } })
    const lay = { pane0: { mainMargins: { top: 0.2, bottom: 0.1 } }, priceIndex: 0 }
    expect(resolvePlacement(i, PLAIN, { paneLayout: lay }).scaleOptions.scaleMargins).toEqual({ top: 0.2, bottom: 0.1 })
    const bare = resolvePlacement(i, PLAIN, {})
    expect(bare.scaleOptions.scaleMargins).toEqual({ ...NO_STACK_MAIN_MARGINS })
    bare.scaleOptions.scaleMargins.top = 99
    expect(resolvePlacement(i, PLAIN, {}).scaleOptions.scaleMargins.top).toBe(NO_STACK_MAIN_MARGINS.top)
  })

  it('"Same as price" and a non-Fred default are the candles\' scale, unchanged', () => {
    expect(resolvePlacement(inst('u_plain'), PLAIN, { mainScaleMargins: MARGINS })).toEqual(SHARED)
    expect(resolvePlacement(inst('u_plain', { placement: { pinScale: 'price' } }), PLAIN, {})).toEqual(SHARED)
    expect(resolvePlacement(inst('u_fred1', { placement: { pinScale: 'price' } }), FRED, {})).toEqual(SHARED)
  })

  it('EVERY registry definition with nothing stored answers exactly as before, on price and in a pane', () => {
    const defs = nativeRegistry.listDefinitions()
    expect(defs.length).toBeGreaterThan(20)
    for (const def of defs) {
      for (const target of ['price', undefined]) {
        const i = inst(def.id, target ? { placement: { target } } : {})
        const r = resolvePlacement(i, def, { mainScaleMargins: MARGINS })
        if (r && typeof r.scaleId === 'string') expect(r.scaleId.startsWith('pin:'), def.id).toBe(false)
        expect(pinScaleOf(i, def), def.id).toBe('price')
      }
    }
  })

  it('a stored pick is ignored off price, for an ownScale definition and for an economic primary', () => {
    const pane = resolvePlacement(inst('atr', { placement: { target: 'pane', pinScale: 'none' } }), ATR, {
      paneLayout: computePaneLayout([inst('atr')], { chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX }),
    })
    expect(pane && pane.scaleId).not.toMatch(/^pin:/)
    expect(resolvePlacement(inst('atr', { placement: { pinScale: 'none' } }), OWN, {}).scaleId).toBe('own:atr:1')
    expect(pinScaleOffered(OWN)).toBe(false)
    // and its answer is never "No scale", whatever is stored (the eligibility look reads it)
    expect(pinScaleOf(inst('atr', { placement: { pinScale: 'none' } }), OWN)).toBe('price')
    expect(pinScaleOf(inst('atr'), { ...OWN, meta: { name: 'Fred RS' } })).toBe('price')
    expect(resolvePlacement({ instanceId: 'econp:FEDFUNDS', defId: 'u_plain', placement: { pinScale: 'none' } }, PLAIN, {}).scaleId)
      .toBe(MAIN_PRICE_SCALE_ID)
  })

  it('an unknown stored value is no pick', () => {
    expect(pinScaleOf(inst('u_plain', { placement: { pinScale: 'left' } }), PLAIN)).toBe('price')
    expect(pinScaleOf(inst('u_plain', { placement: { pinScale: true } }), PLAIN)).toBe('price')
  })
})

describe('the Fred RS default', () => {
  it('an unedited Fred RS copy with nothing stored is "No scale" (no migration write)', () => {
    expect(defaultPinScaleOf(FRED)).toBe(PIN_SCALE_NONE)
    expect(pinScaleOf(inst('u_fred1'), FRED)).toBe(PIN_SCALE_NONE)
    expect(resolvePlacement(inst('u_fred1'), FRED, { mainScaleMargins: MARGINS })).toEqual(EXPECTED('u_fred1:1'))
  })

  it('a member who picked "Same as price" keeps it', () => {
    expect(pinScaleOf(inst('u_fred1', { placement: { pinScale: 'price' } }), FRED)).toBe(PIN_SCALE_PRICE)
  })

  it('the name is case- and space-insensitive; an EDITED copy and a different script are ordinary', () => {
    expect(defaultPinScaleOf({ ...FRED, meta: { name: '  fred rs ' } })).toBe(PIN_SCALE_NONE)
    expect(defaultPinScaleOf(FRED_EDITED)).toBe(PIN_SCALE_PRICE)
    expect(defaultPinScaleOf(PLAIN)).toBe(PIN_SCALE_PRICE)
    expect(defaultPinScaleOf(null)).toBe(PIN_SCALE_PRICE)
  })
})

describe('series options', () => {
  const PLOT = ATR.plots.find((p) => p.style !== 'hlines')
  it('carry the instance scale, the own-autoscale provider and no axis tag', () => {
    const pl = resolvePlacement(inst('u_fred1'), FRED, {})
    const o = seriesOptionsForPlot(PLOT, { scaleId: pl.scaleId, autoscale: pl.autoscale, lastValue: pl.lastValue })
    expect(o.priceScaleId).toBe('pin:u_fred1:1')
    expect(o.autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)
    expect(o.lastValueVisible).toBe(false)
  })
})

// ─── a REAL chart ────────────────────────────────────────────────────────────

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

  const T = (i) => 1_700_000_000 + i * 86_400
  const N = 200
  const CANDLES = Array.from({ length: N }, (_, i) => ({ time: T(i), open: 150 + i, high: 152 + i, low: 149 + i, close: 151 + i }))
  /** Fred's shape: RS = close / SPX × k, about half of price and drifting. */
  const RS = Array.from({ length: N }, (_, i) => ({ time: T(i), value: 0.47 * (151 + i) + 6 * Math.sin(i / 9) }))
  const PLOT = ATR.plots.find((p) => p.style !== 'hlines')

  function build(placement) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const chart = createChart(el, { width: 800, height: 400 })
    const candles = chart.addSeries(CandlestickSeries, {})
    candles.setData(CANDLES)
    candles.priceScale().applyOptions({ scaleMargins: MARGINS })
    chart.timeScale().setVisibleLogicalRange({ from: 0, to: N - 1 })
    let line = null
    if (placement) {
      line = chart.addSeries(LineSeries, seriesOptionsForPlot(PLOT, {
        scaleId: placement.scaleId, autoscale: placement.autoscale, lastValue: placement.lastValue,
      }))
      if (placement.scaleOptions) line.priceScale().applyOptions(placement.scaleOptions)
      line.setData(RS)
    }
    return { chart, candles, line }
  }
  /** The line's pixel rows over the window the time scale ACTUALLY shows (it adjusts what it is asked for). */
  const visibleYs = (chart, line) => {
    const vr = chart.timeScale().getVisibleLogicalRange()
    const from = Math.max(0, Math.ceil(vr.from))
    const to = Math.min(N - 1, Math.floor(vr.to))
    return RS.slice(from, to + 1).map((p) => line.priceToCoordinate(p.value))
  }

  it('the candles\' range is unchanged and the line fills the candles\' band', async () => {
    const pl = resolvePlacement(inst('u_fred1'), FRED, { mainScaleMargins: MARGINS })
    const alone = build(null).candles.priceScale().getVisibleRange()
    const { chart, candles, line } = build(pl)
    expect(candles.priceScale().getVisibleRange()).toEqual(alone)
    expect(line.priceScale().options().visible).toBe(false)
    await new Promise((r) => setTimeout(r, 60))
    const h = chart.panes()[0].getHeight()
    const ys = visibleYs(chart, line)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(MARGINS.top * h - 1)
    expect(Math.max(...ys)).toBeLessThanOrEqual((1 - MARGINS.bottom) * h + 1)
    // fills it: top and bottom of the line within a few pixels of the band's edges
    expect(Math.min(...ys)).toBeLessThan(MARGINS.top * h + 4)
    expect(Math.max(...ys)).toBeGreaterThan((1 - MARGINS.bottom) * h - 4)
  })

  it('it re-frames to the VISIBLE window when the window moves (pan / zoom)', async () => {
    const pl = resolvePlacement(inst('u_fred1'), FRED, { mainScaleMargins: MARGINS })
    const { chart, line } = build(pl)
    const h = chart.panes()[0].getHeight()
    const ranges = []
    for (const [from, to] of [[0, 40], [60, 90], [150, 199]]) {
      chart.timeScale().setVisibleLogicalRange({ from, to })
      await new Promise((r) => setTimeout(r, 60))
      const ys = visibleYs(chart, line)
      expect(Math.min(...ys), `${from}-${to}`).toBeLessThan(MARGINS.top * h + 4)
      expect(Math.max(...ys), `${from}-${to}`).toBeGreaterThan((1 - MARGINS.bottom) * h - 4)
      ranges.push(line.priceScale().getVisibleRange())
    }
    // the scale itself moved with the window: three windows, three different ranges, rising with RS
    expect(ranges[0].to).toBeLessThan(ranges[1].from)
    expect(ranges[1].to).toBeLessThan(ranges[2].from)
  })

  it('CONTROL: on the candles\' scale the same line sits low, under the bars, and does not fill', () => {
    const { chart, line } = build(SHARED)
    const h = chart.panes()[0].getHeight()
    const ys = visibleYs(chart, line).filter((y) => y !== null)
    // RS is about half of price: on a $150-$350 axis it sits at or below the bottom
    expect(ys.length === 0 || Math.min(...ys) > (1 - MARGINS.bottom) * h - 40).toBe(true)
  })

  it('objects map through the instance\'s scale: the label at y = rs lands ON the line', () => {
    const pl = resolvePlacement(inst('u_fred1'), FRED, { mainScaleMargins: MARGINS })
    const { candles, line } = build(pl)
    const host = objectPriceHost([{ series: line }], candles)
    expect(host).toBe(line)
    const last = RS[N - 1].value
    expect(host.priceToCoordinate(last)).toBe(line.priceToCoordinate(last))
    // CONTROL: the candles' map puts the same value nowhere near the line
    expect(Math.abs(candles.priceToCoordinate(last) - line.priceToCoordinate(last))).toBeGreaterThan(40)
  })
})

describe('objectPriceHost', () => {
  const s = (priceScaleId, visible = true) => ({ options: () => ({ priceScaleId, visible }) })
  it('picks a visible series on an instance scale, else any on one, else the fallback', () => {
    const candles = s('right')
    const hid = s('pin:a', false)
    const shown = s('pin:a')
    expect(objectPriceHost([{ series: hid }, { series: shown }], candles)).toBe(shown)
    expect(objectPriceHost([{ series: hid }], candles)).toBe(hid)
    expect(objectPriceHost([{ series: s('right') }], candles)).toBe(candles)
    expect(objectPriceHost([], candles)).toBe(candles)
    expect(objectPriceHost(null, candles)).toBe(candles)
    expect(isInstanceScaleId('own:x')).toBe(true)
    expect(isInstanceScaleId('right')).toBe(false)
  })
})

describe('through the binder (a recording chart)', () => {
  const bars = makeBars()
  const reg = (def) => ({ ...nativeRegistry, getDefinition: (id) => (id === def.id ? def : nativeRegistry.getDefinition(id)) })
  const ctxFor = (instances, registry) => ({
    enabled: true, registry, instances, bars, adjustTime: (t) => t, resolvePlacement,
    paneMargins: {}, mainScaleMargins: MARGINS,
    paneLayout: computePaneLayout([], { chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX }),
    volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1, plan: { fresh: true },
    applyData: (series, data) => { if (series && data) series.setData(data) },
  })

  it('a Fred copy binds on its own scale, with no tag, writing only its own scale', () => {
    const fake = createFakeChart()
    const r = createBinder({ chart: fake.chart, LWC: fake.LWC }).sync(ctxFor([inst('u_fred1')], reg(FRED)))
    expect(r && r.bound).toBeGreaterThan(0)
    expect(fake.seriesCreated.length).toBeGreaterThan(0)
    for (const x of fake.seriesCreated) {
      expect(x.__options.priceScaleId).toBe('pin:u_fred1:1')
      expect(x.__options.lastValueVisible).toBe(false)
    }
    const writes = fake.calls.filter((c) => c.method === 'priceScale.applyOptions').map((c) => c.args[0])
    expect(writes).toEqual([EXPECTED('u_fred1:1').scaleOptions])
    expect(fake.calls.filter((c) => c.id === 'chart:right')).toEqual([])
  })

  it('CONTROL: a non-Fred script binds on the candles\' scale, asserting nothing', () => {
    const fake = createFakeChart()
    createBinder({ chart: fake.chart, LWC: fake.LWC }).sync(ctxFor([inst('u_plain')], reg(PLAIN)))
    expect(fake.seriesCreated.length).toBeGreaterThan(0)
    for (const x of fake.seriesCreated) expect(x.__options.priceScaleId).toBe(MAIN_PRICE_SCALE_ID)
    expect(fake.calls.filter((c) => c.method === 'priceScale.applyOptions')).toEqual([])
  })

  it('an event glyph pinned to "No scale" does not ride the candles', () => {
    const plot = { key: 'g', style: 'markers', marker: { shape: 'circle' } }
    const b = { instanceId: 'x', plot, def: { plots: [plot] }, inst: { inputs: {} }, poolKey: 'line' }
    const isCondition = () => true
    expect(eventGlyphHosts([b], [{ paneIndex: 0, scaleId: 'right' }], { isCondition })).toEqual(['price'])
    expect(eventGlyphHosts([b], [{ paneIndex: 0, scaleId: 'pin:x' }], { isCondition })).toEqual([null])
  })
})

describe('an average pinned to "No scale" keeps its own autoscale', () => {
  const MA = nativeRegistry.getDefinition('movingAverage')
  const get = (id) => (id === 'movingAverage' ? MA : nativeRegistry.getDefinition(id))
  const ctx = { targetOf: () => 'price', fitPriceToCandles: true }
  it('fitPriceToCandles excludes a shared average, never a pinned one', () => {
    const shared = eligibleInstances([inst('movingAverage')], get, ctx).kept[0]
    const pinned = eligibleInstances([inst('movingAverage', { placement: { pinScale: 'none' } })], get, ctx).kept[0]
    expect(shared.renderLook.autoscale).toBe('exclude')
    expect(pinned.renderLook.autoscale).toBe('default')
  })
})

describe('the writer, and the round trip', () => {
  const cs = () => ({ indicatorInstances: [inst('atr', { placement: { target: 'price' } })] })
  it('every pick is stored, including one equal to the default; a repeat or unknown pick is refused', () => {
    const a = setInstancePinScale(cs(), 'atr:1', 'none')
    expect(a.indicatorInstances[0].placement).toEqual({ target: 'price', pinScale: 'none' })
    const b = setInstancePinScale(a, 'atr:1', 'price')
    expect(b.indicatorInstances[0].placement.pinScale).toBe('price')
    expect(setInstancePinScale(b, 'atr:1', 'price')).toBe(b)
    expect(setInstancePinScale(b, 'atr:1', 'left')).toBe(b)
    expect(setInstancePinScale(b, 'nope', 'none')).toBe(b)
  })

  it('the stored pick survives the instance normaliser (a saved layout reloads with it)', () => {
    const a = setInstancePinScale(cs(), 'atr:1', 'none')
    const round = normalizeInstances(JSON.parse(JSON.stringify(a.indicatorInstances)))
    const list = round.kept
    expect(list.find((i) => i.instanceId === 'atr:1').placement.pinScale).toBe('none')
  })
})
