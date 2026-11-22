// app/src/components/chart/engine/binder.optionsHeld.test.js
//
// ─── A SERIES IS NOT HANDED A SET IT ALREADY HOLDS (paint, 2026-11-21) ────────────────────────────────────────────
//
// Every `series.applyOptions` marks the series' pane view "options changed", and the next paint restyles every item
// of that series (lightweight-charts 5.2.0, `SeriesPaneViewBase` -> the per-item bar colourer: a search for the row
// plus two object spreads per item). Measured on eight real-Chrome list flips of the production build: 8.3 ms of
// each flip's paint, and the binder handed every reused series its whole set on every sync, unchanged or not.
//
// Three halves:
//   * `optionsHeld` against the library's own `merge` (what a write would change);
//   * the binder on the recording double: an unchanged re-sync writes ONE series (the carrier of the full update),
//     a changed option still reaches its series, and a value another writer set since is put back;
//   * the binder on the real library, step for step against a CONTROL whose series cannot say what they hold
//     (so every set is written, as before this change): every option of every series, the axis width, the price
//     range and the labels drawn are identical after each step, including the switch onto narrower prices, where
//     the axis must re-fit (the full update the carrier keeps).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as LWC from 'lightweight-charts'
import { createBinder, optionsHeld } from './binder'
import { createFakeChart, makeBars } from './__tests__/fakeChart'
import { resolvePlacement } from './placement'
import { computePaneLayout, SEPARATOR_PX } from './paneLayout'
import * as nativeRegistry from './nativeRegistry'

const holding = (now) => ({ options: () => now })

describe('optionsHeld: what a write would change, by the library\'s merge', () => {
  const NOW = { color: '#111', lineWidth: 2, visible: true, priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    autoscaleInfoProvider: null, lineDash: [4, 2], title: '' }
  it('the same values are held; one different value is not', () => {
    expect(optionsHeld(holding(NOW), { color: '#111', lineWidth: 2, visible: true })).toBe(true)
    expect(optionsHeld(holding(NOW), { color: '#111', lineWidth: 3 })).toBe(false)
    expect(optionsHeld(holding(NOW), { visible: false })).toBe(false)
    expect(optionsHeld(holding(NOW), { title: 'x' })).toBe(false)
  })
  it('a plain object merges key by key: its keys are compared, the keys it leaves out stay', () => {
    expect(optionsHeld(holding(NOW), { priceFormat: { precision: 2 } })).toBe(true)
    expect(optionsHeld(holding(NOW), { priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })).toBe(true)
    expect(optionsHeld(holding(NOW), { priceFormat: { precision: 3 } })).toBe(false)
    expect(optionsHeld(holding(NOW), { priceFormat: { minMove: 0.001 } })).toBe(false)
    // an object over nothing is ASSIGNED: not held
    expect(optionsHeld(holding(NOW), { scaleMargins: { top: 0.1 } })).toBe(false)
  })
  it('undefined is skipped, null over a value is a no-op, null over nothing is not', () => {
    expect(optionsHeld(holding(NOW), { color: undefined, lineWidth: 2 })).toBe(true)
    expect(optionsHeld(holding(NOW), { priceFormat: null })).toBe(true)
    expect(optionsHeld(holding(NOW), { autoscaleInfoProvider: null })).toBe(true)
    expect(optionsHeld(holding(NOW), { baseLineColor: null })).toBe(false)
  })
  it('a function by identity, an array by its items', () => {
    const f = () => null
    expect(optionsHeld(holding({ ...NOW, autoscaleInfoProvider: f }), { autoscaleInfoProvider: f })).toBe(true)
    expect(optionsHeld(holding({ ...NOW, autoscaleInfoProvider: f }), { autoscaleInfoProvider: () => null })).toBe(false)
    expect(optionsHeld(holding(NOW), { lineDash: [4, 2] })).toBe(true)
    expect(optionsHeld(holding(NOW), { lineDash: [4, 3] })).toBe(false)
    expect(optionsHeld(holding(NOW), { lineDash: [4] })).toBe(false)
  })
  it('a series that cannot say what it holds holds nothing', () => {
    expect(optionsHeld({}, { color: '#111' })).toBe(false)
    expect(optionsHeld({ options: () => null }, { color: '#111' })).toBe(false)
    expect(optionsHeld({ options: () => { throw new Error('disposed') } }, { color: '#111' })).toBe(false)
    expect(optionsHeld(null, { color: '#111' })).toBe(false)
  })
})

// ─── the binder, on the recording double ───────────────────────────────────────────────────────────────────────────
const bars = makeBars(400)
const inst = (defId, over = {}) => ({ instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...over })
const ctxFor = (instances, extra = {}) => ({
  enabled: true, registry: nativeRegistry, instances, bars, adjustTime: (t) => t, resolvePlacement,
  paneMargins: {}, paneLayout: computePaneLayout(instances, { chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX }),
  volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1, plan: { fresh: true },
  applyData: (series, data) => { if (series && data) series.setData(data) },
  ...extra,
})
const seriesWrites = (fake) => fake.calls.filter((c) => c.on === 'series' && c.method === 'applyOptions')

describe('the binder hands a series only a set it does not already hold', () => {
  const SET = [inst('rsi'), inst('macd'), inst('atr')]
  it('an unchanged re-sync writes one series, carrying priceFormat (the full update); every series was reused', () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    binder.sync(ctxFor(SET))
    const n = binder.bindings().length
    expect(n, 'too few series: the count below proves nothing').toBeGreaterThanOrEqual(5)
    fake.reset()
    binder.sync(ctxFor(SET))
    expect(fake.count('addSeries')).toBe(0)
    const writes = seriesWrites(fake)
    expect(writes, `${n} reused series, every set unchanged`).toHaveLength(1)
    expect(writes[0].args[0].priceFormat, 'the one write carries the full update').toBeTruthy()
  })
  it('a changed option reaches its series (and only that one besides the carrier)', () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    binder.sync(ctxFor([inst('atr'), inst('rsi', { inputs: { color: '#111111' } })]))
    const rsiSeries = binder.bindings().find((b) => b.instanceId === 'legacy:rsi').series
    fake.reset()
    binder.sync(ctxFor([inst('atr'), inst('rsi', { inputs: { color: '#222222' } })]))
    const onRsi = seriesWrites(fake).filter((c) => c.id === rsiSeries.__id)
    expect(onRsi).toHaveLength(1)
    expect(onRsi[0].args[0].color).toBe('#222222')
    expect(rsiSeries.options().color).toBe('#222222')
    expect(seriesWrites(fake)).toHaveLength(2)
  })
  it('a nested change (priceFormat alone) reaches a series that is not the carrier', () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const set = [inst('atr'), inst('rsi')]
    binder.sync(ctxFor(set))
    const rsiSeries = binder.bindings().find((b) => b.instanceId === 'legacy:rsi').series
    const before = rsiSeries.options().priceFormat
    expect(before && before.precision, 'no precision to change: vacuous').toBeDefined()
    // what another writer leaves behind: the same keys, one value moved
    rsiSeries.__options.priceFormat = { ...before, precision: before.precision + 3 }
    fake.reset()
    binder.sync(ctxFor(set))
    const onRsi = seriesWrites(fake).filter((c) => c.id === rsiSeries.__id)
    expect(onRsi, 'the precision moved: the set is not held').toHaveLength(1)
    expect(rsiSeries.options().priceFormat.precision).toBe(before.precision)
  })
  it('a value another writer set since is put back, as every sync put it back before', () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    binder.sync(ctxFor(SET))
    const last = binder.bindings()[binder.bindings().length - 1].series
    expect(last.options().visible).toBe(true)
    last.applyOptions({ visible: false })           // e.g. the Group-only effect
    fake.reset()
    binder.sync(ctxFor(SET))
    const onLast = seriesWrites(fake).filter((c) => c.id === last.__id)
    expect(onLast).toHaveLength(1)
    expect(last.options().visible).toBe(true)
  })
})

// ─── the binder on the real library, against a control that writes every set ─────────────────────────────────────
describe('on lightweight-charts itself: the same chart as writing every set, step for step', () => {
  let queue = []
  let drawn = null
  const saved = {}
  beforeAll(() => {
    // jsdom has no 2D context and no layout; a label's width grows with its text so the axis can re-fit
    const ctx = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'canvas') return { width: 900, height: 500 }
        if (k === 'measureText') return (text) => ({ width: 7 * String(text).length, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
        if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
        if (k === 'fillText') return (text) => { if (drawn) drawn.push(String(text)) }
        return () => {}
      },
      set: () => true,
    })
    saved.getContext = HTMLCanvasElement.prototype.getContext
    saved.raf = window.requestAnimationFrame
    saved.caf = window.cancelAnimationFrame
    HTMLCanvasElement.prototype.getContext = () => ctx
    // the library's frames run when the test says so
    window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length }
    window.cancelAnimationFrame = () => {}
  })
  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = saved.getContext
    window.requestAnimationFrame = saved.raf
    window.cancelAnimationFrame = saved.caf
  })
  const frames = () => { for (let i = 0; i < 20 && queue.length; i++) { const now = queue.splice(0); for (const cb of now) cb(performance.now()) } }

  const priced = (n, base) => makeBars(n).map((b) => ({ ...b, o: b.o * base, h: b.h * base, l: b.l * base, c: b.c * base }))
  const MA = (i, period) => ({ instanceId: `ovl:${i}`, defId: 'movingAverage', inputs: { source: 'close', period, maType: 'ema' }, hidden: false })
  const SET = [MA(0, 10), MA(1, 21), MA(2, 50), { instanceId: 't:bb', defId: 'bb', inputs: {}, hidden: false }]
  // overlays only: no price-scale write, so the axis re-fit on a switch can come only from the series' own writes
  const onPrice = () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: null })

  /** A chart, its candles and a binder. `control`: its series cannot say what they hold (every set is written). */
  function rig(control) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const chart = LWC.createChart(el, { width: 900, height: 500 })
    const candles = chart.addSeries(LWC.CandlestickSeries, {})
    const writes = { n: 0 }
    const add = chart.addSeries.bind(chart)
    const real = new Map()
    chart.addSeries = (...a) => {
      const s = add(...a)
      const own = s.options.bind(s)
      const apply = s.applyOptions.bind(s)
      real.set(s, own)
      if (control) s.options = () => null
      s.applyOptions = (o) => { writes.n += 1; return apply(o) }
      return s
    }
    const binder = createBinder({ chart, LWC, scope: control ? 'control' : 'held' })
    const sync = (b, extra = {}) => {
      candles.setData(b.map((x) => ({ time: x.t, open: x.o, high: x.h, low: x.l, close: x.c })))
      binder.sync({ enabled: true, registry: nativeRegistry, instances: SET, bars: b, sym: 'X', tf: 'D', cs: null,
        adjustTime: (t) => t, plan: {}, resolvePlacement: onPrice, priceSeries: () => candles,
        applyData: (series, data) => { if (series && data) series.setData(data) }, ...extra })
    }
    const look = () => ({
      options: binder.bindings().map((b) => [`${b.instanceId}::${b.plotKey}`, real.get(b.series) ? real.get(b.series)() : null]),
      axisWidth: chart.priceScale('right').width(),
      range: candles.priceScale().getVisibleRange(),
    })
    return { chart, binder, sync, look, writes, real, el }
  }

  it('bind, re-sync, a switch onto narrower prices, another writer\'s change, a new axis format', () => {
    const held = rig(false)
    const ctrl = rig(true)
    const both = (f) => { f(held); f(ctrl) }
    const paint = () => {
      drawn = []
      frames()
      const labels = drawn
      drawn = null
      return labels
    }
    const step = (name, f) => {
      const w0 = { held: held.writes.n, ctrl: ctrl.writes.n }
      both(f)
      const labels = paint()
      const a = held.look()
      const b = ctrl.look()
      expect(a.options, `${name}: every option of every series`).toEqual(b.options)
      expect(a.axisWidth, `${name}: the axis width`).toBe(b.axisWidth)
      expect(a.range, `${name}: the price range`).toEqual(b.range)
      return { a, labels, writes: { held: held.writes.n - w0.held, ctrl: ctrl.writes.n - w0.ctrl } }
    }
    // the labels drawn, per chart: painted together, so compare each chart's own
    const labelsOf = (r) => { drawn = []; r.chart.timeScale().fitContent(); frames(); const l = drawn; drawn = null; return l }

    const wide = priced(300, 100)       // prices in the thousands
    const narrow = priced(300, 0.1)     // prices around ten
    const s1 = step('bind', (r) => r.sync(wide))
    expect(s1.a.options.length, 'nothing bound: vacuous').toBeGreaterThanOrEqual(5)
    const s2 = step('re-sync', (r) => r.sync(wide))
    // soft: a wrong count must not hide what the steps after it would show
    expect.soft(s2.writes.ctrl, 'the control writes every reused series').toBe(s1.a.options.length)
    expect.soft(s2.writes.held, 'unchanged: one write, the full update\'s carrier').toBe(1)
    const wideAxis = s2.a.axisWidth
    const s3 = step('switch onto narrower prices', (r) => r.sync(narrow))
    expect(s3.a.axisWidth, 'the axis re-fit to the narrower labels (non-vacuous)').toBeLessThan(wideAxis)
    step('another writer hides a series', (r) => {
      const last = r.binder.bindings()[r.binder.bindings().length - 1].series
      last.applyOptions({ visible: false })
      r.sync(narrow)
    })
    const s5 = step('a new axis format on the candles\' axis', (r) => r.sync(narrow, { mainPriceFormat: { type: 'price', precision: 4, minMove: 0.0001 } }))
    expect(s5.a.options.some(([, o]) => o && o.priceFormat && o.priceFormat.precision === 4), 'the format reached no series: vacuous').toBe(true)
    expect(labelsOf(held)).toEqual(labelsOf(ctrl))
    for (const r of [held, ctrl]) { r.binder.teardown(); r.chart.remove(); r.el.remove() }
  })
  it('the work: a sync restyles the items of each series once for its data, not once more for an unchanged set', () => {
    queue.length = 0 // the frames the last test's charts still asked for: those charts are gone
    // every per-item restyle goes through the series' bar colourer (`SeriesBarColorer.barStyle`, 5.2.0 dev build): a data
    // change restyles every item of the series (its pane view rebuilds), and so did every `applyOptions`
    const held = rig(false)
    const ctrl = rig(true)
    held.sync(priced(300, 100)); ctrl.sync(priced(300, 100)); frames()
    const one = held.binder.bindings()[0].series
    const proto = Object.getPrototypeOf(one._internal__series._internal_barColorer())
    const own = proto._internal_barStyle
    let n = 0
    proto._internal_barStyle = function counted(...a) { n += 1; return own.apply(this, a) }
    try {
      const work = (r, b) => { n = 0; r.sync(b); frames(); return n }
      const resync = { held: work(held, priced(300, 100)), ctrl: work(ctrl, priced(300, 100)) }
      const sw = { held: work(held, priced(300, 0.1)), ctrl: work(ctrl, priced(300, 0.1)) }
      console.log(`[options held] restyled items: re-sync ${JSON.stringify(resync)}, switch ${JSON.stringify(sw)}`)
      expect(resync.ctrl, 'the control restyled nothing: vacuous').toBeGreaterThan(1000)
      expect(resync.held, 'a re-sync (new bars, the same sets)').toBeLessThan(resync.ctrl * 0.7)
      expect(sw.held, 'a switch').toBeLessThan(sw.ctrl * 0.7)
    } finally {
      proto._internal_barStyle = own
      for (const r of [held, ctrl]) { r.binder.teardown(); r.chart.remove(); r.el.remove() }
    }
  })
})
