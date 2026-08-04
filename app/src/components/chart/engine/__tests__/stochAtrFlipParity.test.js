import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { AUTOSCALE_DEFAULT } from '../pool'
import * as engineRegistry from '../nativeRegistry'
import { computeStochastic, computeATR } from '../../indicators'
import { computePaneMargins } from '../../paneMargins'
import { createFakeChart, makeBars } from './fakeChart'

// ─── THE FLIP-A CONTRACT FOR STOCHASTIC AND ATR (B5 Task 5) ─────────────────
//
// Written and run BEFORE `StockChart.jsx` is touched, which is the whole point:
// every literal below is a VERBATIM copy of the shipped block's `addSeries` /
// `applyIndScale` / `createPriceLine` arguments, so a failure here is a
// definition-vs-shipped-block disagreement — the migration's pixel diff,
// arriving before the migration and for free. It passed on the un-migrated tree
// and must keep passing on the migrated one.
//
// ⚠️ `toEqual` OVER THE FULL OPTION OBJECT, NEVER `toMatchObject`. A
// `toMatchObject` transcription passes with an extra `lastValueVisible: true`
// that puts an axis tag on the chart the hand-written block never drew — and
// that is a pixel change the definition would have been carrying all along.
//
// ⚠️ AND A `createPriceLine` OPTION IS NOT A SERIES OPTION. An omitted SERIES
// option means "keep what's there"; an omitted `createPriceLine` option means
// LWC's OWN DEFAULT, which for `lineStyle` is Dashed. That asymmetry cost 379
// changed pixels on RSI's 50-midline at B3, and Stochastic's 80/20 guides are
// the same shape — so `LEGACY_GUIDES` below states every key, style included.
//
// ⭐ ATR IS NOT SYMMETRIC WITH STOCH, AND THE TWO CASES THAT SAY SO ARE THE
// POINT OF PAIRING THEM. Stoch is a FIXED-RANGE pane (`fixedPane(0, 100)` →
// `{autoScale:false, minimum:0, maximum:100}`, the same shape as RSI); ATR is an
// AUTOSCALED one (`autoPane` → `{autoScale:true}`), it is a PRICE-unit number
// rather than a 0-100 oscillator, it draws no guides at all, and its chip
// carries the period in brackets (`meta.legendParams: ['period']`) where
// Stochastic's two deliberately carry none. `engine_atr_vs_legacy` is the first
// parity case in the branch's history to render an `autoScale: true` band
// through the engine.
//
// ⚠️ AND THE VOLUME-PANE OVERLAY PATH HAS NEVER BEEN GATED BY ANY PILOT. All
// four B3 pilots are either price overlays (no overlay path) or were only ever
// measured in their own bands. `stoch` and `atr` are both eligible for
// `ensureIndTarget`'s `volSeparatePane && volOverlaySet.has(key)` branch, so the
// two `on the volume pane's LEFT axis` cases below are the first assertions this
// branch has ever made about it.

// ─── the literal transcription ──────────────────────────────────────────────
// `StockChart.jsx:6379-6463` at `1ee1bab3`, verbatim. Do not "tidy" these —
// their whole value is that they are a copy of the shipped call.

/** `chart.addSeries(LineSeries, <this>, stochTgt.pane)` — `:6384-6389`. */
const LEGACY_STOCH_K = {
  priceScaleId: 'stoch',
  color: '#FF6B6B',
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}

/** `:6390-6396`. Identical, plus the `lineStyle: 2` that is the ONLY thing
 *  distinguishing %D from %K on the canvas. */
const LEGACY_STOCH_D = {
  ...LEGACY_STOCH_K,
  color: '#4ECDC4',
  lineStyle: 2,
}

/** `:6442-6449`. */
const LEGACY_ATR = {
  priceScaleId: 'atr',
  color: '#FFA726',
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}

/**
 * The options the engine states that the legacy blocks do NOT — each equal to
 * the value a freshly-created LWC 5.2.0 line series already has, so a CREATED
 * series is byte-identical and a RE-PURPOSED one is reset to it.
 *
 * The complete-key-set rule (`pool.seriesOptionsForPlot`) is why they exist:
 * `applyOptions` MERGES and `merge()` SKIPS `undefined`, so an option a plot
 * does not name survives from the previous tenant. `stoch.d → mfi.mfi` leaking
 * `lineStyle: 2` is a MEASURED example in that module's header, which makes %D
 * one of the two plots that motivated the rule in the first place.
 *
 * `lineStyle: 0` is in here for %K and ATR and is DELIBERATELY NOT in the %D
 * expectation below — %D declares `lineStyle: 'dashed'`, so its 2 is a
 * transcription of the legacy call, not a restatement of a default.
 */
const LWC_LINE_DEFAULTS_RESTATED = {
  visible: true,
  lineStyle: 0,
  lineType: 0,
  pointMarkersVisible: false,
  pointMarkersRadius: 3,
  priceFormat: { type: 'price', precision: 2 },
  autoscaleInfoProvider: AUTOSCALE_DEFAULT,
}

/** `applyIndScale(key, series, tgt, bandExtra)`'s non-`left` branch, `:6037`. */
const legacyBandScale = (band, extra) => ({
  borderVisible: false,
  scaleMargins: band,
  ...extra,
})

/** `applyIndScale`'s `left` branch, `:6035` — verbatim, every key. */
const LEGACY_LEFT_AXIS = {
  borderVisible: false,
  visible: true,
  autoScale: true,
  scaleMargins: { top: 0.12, bottom: 0.04 },
}

/** `stochKRef.current.createPriceLine(<these>)` — `:6398-6399`. Both land on
 *  %K's series, which is exactly where `planBindings` puts an instance's guides
 *  (the FIRST data-bearing plot). ⛔ NO `title` KEY: the shipped calls state
 *  none, and adding one draws a label the hand-written block never drew. */
const LEGACY_GUIDES = [
  { price: 80, color: 'rgba(255,107,107,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false },
  { price: 20, color: 'rgba(78,205,196,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false },
]

// ─── the fixtures ───────────────────────────────────────────────────────────

const BARS = makeBars(260)

const STOCH_INSTANCE = {
  instanceId: 'legacy:stoch', defId: 'stoch', defVersion: 1,
  inputs: { kPeriod: 14, dPeriod: 3, kColor: '#FF6B6B', dColor: '#4ECDC4' },
  placement: { target: 'pane' }, hidden: false,
}

const ATR_INSTANCE = {
  instanceId: 'legacy:atr', defId: 'atr', defVersion: 1,
  inputs: { period: 14, color: '#FFA726' },
  placement: { target: 'pane' }, hidden: false,
}

/** The `cs` each parity case pins. Its ONLY job is to feed `computePaneMargins`,
 *  which is what reserves the band the engine has to land in. */
const STOCH_CS = { indicators: { stoch: { enabled: true, kPeriod: 14, dPeriod: 3, kColor: '#FF6B6B', dColor: '#4ECDC4' } } }
const ATR_CS = { indicators: { atr: { enabled: true, period: 14, color: '#FFA726' } } }
const STOCH_BAND = computePaneMargins(STOCH_CS, false, new Set()).stoch
const ATR_BAND = computePaneMargins(ATR_CS, false, new Set()).atr

const sync = (instance, cs, band, over) => {
  const F = createFakeChart()
  const binder = createBinder({ chart: F.chart, LWC: F.LWC })
  const paneMargins = {}
  if (band) paneMargins[instance.defId] = band
  const result = binder.sync({
    enabled: true, cs, registry: engineRegistry, instances: [instance], bars: BARS,
    adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
    paneMargins, volOverlaySet: new Set(), volSeparatePane: true, VOL_PANE_INDEX: 1,
    ...over,
  })
  return { F, binder, result }
}

const opts = (F, i = 0) => F.callsOf('addSeries')[i].args[1]

describe('stoch transcription — what the shipped block hands the renderer', () => {
  it('reserves a band at all (otherwise every assertion below is about nothing)', () => {
    expect(STOCH_BAND).toEqual({ top: 0.85, bottom: 0 })
  })

  it('creates %K and %D as TWO LineSeries in pane 0, in that order', () => {
    const { F, result } = sync(STOCH_INSTANCE, STOCH_CS, STOCH_BAND)
    expect(result.ok).toBe(true)
    expect(result.bound).toBe(2)
    const created = F.callsOf('addSeries')
    expect(created).toHaveLength(2)
    for (const c of created) {
      expect(c.args[0]).toBe(F.LWC.LineSeries)
      // Flip A draws into a BAND inside pane 0, not a real pane. A `1` here is
      // the B5 geometry arriving early, and it would move every other series.
      expect(c.args[2]).toBe(0)
    }
  })

  it('%K: the engine builds the shipped option object, key for key', () => {
    const { F } = sync(STOCH_INSTANCE, STOCH_CS, STOCH_BAND)
    expect(opts(F, 0)).toMatchObject(LEGACY_STOCH_K)
    expect(opts(F, 0)).toEqual({ ...LEGACY_STOCH_K, ...LWC_LINE_DEFAULTS_RESTATED })
  })

  it('%D: including lineStyle 2, which is the only thing that distinguishes it', () => {
    const { F } = sync(STOCH_INSTANCE, STOCH_CS, STOCH_BAND)
    expect(opts(F, 1)).toMatchObject(LEGACY_STOCH_D)
    // ⚠️ The spread order matters: `LEGACY_STOCH_D` must WIN over the restated
    // `lineStyle: 0`, or this case would assert %D is solid and pass on a
    // definition that had dropped its dash.
    expect(opts(F, 1)).toEqual({ ...LWC_LINE_DEFAULTS_RESTATED, ...LEGACY_STOCH_D })
    expect(opts(F, 1).lineStyle, '%D lost its dash — the only thing that distinguishes it').toBe(2)
    expect(opts(F, 0).lineStyle, '%K is not dashed and never was').toBe(0)
  })

  it('asserts the FULL price-scale set — the band AND the 0-100 fixed range', () => {
    const { F } = sync(STOCH_INSTANCE, STOCH_CS, STOCH_BAND)
    const scaleCalls = F.callsOf('priceScale.applyOptions')
    // ONE call: the guides and both lines share the `stoch` scale, and the
    // binder asserts it per BINDING — so two lines is two calls, both identical.
    expect(scaleCalls).toHaveLength(2)
    for (const call of scaleCalls) {
      expect(call.args[0]).toEqual(
        legacyBandScale(STOCH_BAND, { autoScale: false, minimum: 0, maximum: 100 }))
    }
  })

  it('the two guides are createPriceLine(80) and createPriceLine(20), with EVERY key stated', () => {
    // ⛔ An omitted `createPriceLine` option means LWC's DEFAULT, not "keep".
    // RSI's 50-line cost 379 px on exactly this.
    const { F } = sync(STOCH_INSTANCE, STOCH_CS, STOCH_BAND)
    const lines = F.callsOf('createPriceLine')
    expect(lines).toHaveLength(2)
    expect(lines.map(c => c.args[0])).toEqual(LEGACY_GUIDES)
    // …and on %K's series, which is where the shipped block puts them. Both
    // guides on %D would be invisible in the picture and wrong in the model.
    const kSeries = F.seriesCreated[0]
    for (const c of lines) expect(c.id).toBe(kSeries.__id)
  })

  it('the band is the one computePaneMargins gives stoch, with the 0-100 range pinned', () => {
    const ctx = {
      paneMargins: computePaneMargins(STOCH_CS, true, new Set()),
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'stoch' }, engineRegistry.getDefinition('stoch'), ctx)).toEqual({
      paneIndex: 0, scaleId: 'stoch', autoscale: 'default',
      scaleOptions: {
        borderVisible: false, scaleMargins: ctx.paneMargins.stoch,
        autoScale: false, minimum: 0, maximum: 100,
      },
    })
  })

  it('sets exactly the data the legacy block would have set, on both lines', () => {
    const { F } = sync(STOCH_INSTANCE, STOCH_CS, STOCH_BAND)
    const raw = computeStochastic(BARS, 14, 3)
    const asLegacy = (pts) => pts.map(p => (
      Number.isFinite(p.value) ? { time: p.time, value: p.value } : { time: p.time }))
    const setDataCalls = F.callsOf('setData')
    expect(setDataCalls).toHaveLength(2)
    expect(setDataCalls[0].args[0]).toEqual(asLegacy(raw.k))
    expect(setDataCalls[1].args[0]).toEqual(asLegacy(raw.d))
    // Non-vacuous in both directions: real numbers at the tail, whitespace at
    // the head. Two all-whitespace columns would satisfy `toEqual` and prove
    // nothing — and %D lags %K, so the two heads are different lengths.
    expect(setDataCalls[0].args[0].at(-1).value).toBeGreaterThan(0)
    expect(setDataCalls[1].args[0].at(-1).value).toBeGreaterThan(0)
    expect(setDataCalls[0].args[0][0].value).toBeUndefined()
    expect(setDataCalls[1].args[0][0].value).toBeUndefined()
  })

  it('makes NO other renderer call — nothing removed, nothing moved, nothing extra', () => {
    const { F } = sync(STOCH_INSTANCE, STOCH_CS, STOCH_BAND)
    expect(F.methodsUsed().sort()).toEqual(
      ['addSeries', 'createPriceLine', 'priceScale.applyOptions', 'setData'])
  })

  it('and the volume-overlay path puts BOTH lines on pane 1 / left with the shipped scaleOptions', () => {
    // ⚠️ THE PATH NO B3 PILOT EVER GATED. `ensureIndTarget` sends an oscillator
    // in `cs.volumeOverlayIndicators` to the VOLUME pane's left axis instead of
    // its own band, and none of rsi/bb/macd/vwap could ever exercise it (three
    // are price overlays; RSI's cases never set the list).
    const ctx = {
      paneMargins: {}, volOverlaySet: new Set(['stoch']),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'stoch' }, engineRegistry.getDefinition('stoch'), ctx)).toEqual({
      paneIndex: 1, scaleId: 'left', autoscale: 'default',
      scaleOptions: { ...LEGACY_LEFT_AXIS, scaleMargins: { ...LEGACY_LEFT_AXIS.scaleMargins } },
    })
    // …and it reaches the RENDERER, not only the resolver: pane index 1 on both
    // `addSeries` calls, `priceScaleId: 'left'` on both option objects, and the
    // fixed 0-100 range GONE — the shared axis autoscales, which is exactly what
    // `applyIndScale`'s `left` branch does.
    const { F } = sync(STOCH_INSTANCE, STOCH_CS, null,
      { volOverlaySet: new Set(['stoch']), volSeparatePane: true })
    expect(F.callsOf('addSeries').map(c => c.args[2])).toEqual([1, 1])
    expect(F.callsOf('addSeries').map(c => c.args[1].priceScaleId)).toEqual(['left', 'left'])
    for (const call of F.callsOf('priceScale.applyOptions')) {
      expect(call.args[0]).toEqual({ ...LEGACY_LEFT_AXIS, scaleMargins: { ...LEGACY_LEFT_AXIS.scaleMargins } })
      expect(call.args[0].minimum, 'the shared left axis must not inherit stoch\'s 0-100').toBeUndefined()
    }
  })

  it('a POOLED series is re-fed on a colour change, never destroyed and recreated (#2049)', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, cs: STOCH_CS, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: { stoch: STOCH_BAND }, volOverlaySet: new Set(),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    })
    run(STOCH_INSTANCE)
    run({ ...STOCH_INSTANCE, inputs: { ...STOCH_INSTANCE.inputs, kColor: '#ff0000' } })
    run({ ...STOCH_INSTANCE, inputs: { ...STOCH_INSTANCE.inputs, kColor: '#ff0000', kPeriod: 21 } })
    expect(F.count('addSeries'), 'a restyle or a period change must not create a third series').toBe(2)
    expect(F.count('removeSeries'), 'a restyle must not destroy the series').toBe(0)
    const applied = F.callsOf('applyOptions').filter(c => c.on === 'series')
    expect(applied.length).toBeGreaterThan(0)
    expect(applied.some(c => c.args[0].color === '#ff0000')).toBe(true)
  })

  it('the second pass re-asserts the COMPLETE option set, not a delta', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, cs: STOCH_CS, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: { stoch: STOCH_BAND }, volOverlaySet: new Set(),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    })
    run(STOCH_INSTANCE)
    run({ ...STOCH_INSTANCE, inputs: { ...STOCH_INSTANCE.inputs, kColor: '#ff0000' } })
    const second = F.callsOf('applyOptions').filter(c => c.on === 'series')[0].args[0]
    expect(Object.keys(second).sort()).toEqual(Object.keys(opts(F, 0)).sort())
  })
})

describe('atr transcription — the AUTOSCALED band, which stoch is not', () => {
  it('reserves a band at all, and it is a DIFFERENT band from stoch\'s', () => {
    // ⭐ 0.87, NOT stoch's 0.85 — the first measured asymmetry of the pair. ATR's
    // declared pane height is 0.13 where every 0-100 oscillator's is 0.15, so
    // `computePaneMargins` gives it a SHORTER band and a case that assumed
    // symmetry with `stoch` would have been asserting the wrong rectangle.
    expect(ATR_BAND).toEqual({ top: 0.87, bottom: 0 })
    expect(STOCH_BAND).not.toEqual(ATR_BAND)
    expect(engineRegistry.getDefinition('stoch').placement.pane.height).toBe(0.15)
    expect(engineRegistry.getDefinition('atr').placement.pane.height).toBe(0.13)
  })

  it('one line, autoScale true, on the atr band — full toEqual on both objects', () => {
    const { F, result } = sync(ATR_INSTANCE, ATR_CS, ATR_BAND)
    expect(result.bound).toBe(1)
    const created = F.callsOf('addSeries')
    expect(created).toHaveLength(1)
    expect(created[0].args[0]).toBe(F.LWC.LineSeries)
    expect(created[0].args[2]).toBe(0)
    expect(opts(F)).toMatchObject(LEGACY_ATR)
    expect(opts(F)).toEqual({ ...LEGACY_ATR, ...LWC_LINE_DEFAULTS_RESTATED })

    const scaleCalls = F.callsOf('priceScale.applyOptions')
    expect(scaleCalls).toHaveLength(1)
    // ⭐ `{autoScale: true}` — NOT stoch's `{autoScale:false, minimum, maximum}`.
    // ATR is a price-unit number with no bounds to declare, so `autoPane` emits
    // no `placement.scale` and `resolvePlacement` falls to the autoscale branch.
    expect(scaleCalls[0].args[0]).toEqual(legacyBandScale(ATR_BAND, { autoScale: true }))
    expect(scaleCalls[0].args[0].minimum, 'ATR must not inherit a fixed range').toBeUndefined()
  })

  it('draws NO guides — ATR has no 80/20, no 70/30 and no zero line', () => {
    const { F } = sync(ATR_INSTANCE, ATR_CS, ATR_BAND)
    expect(F.count('createPriceLine')).toBe(0)
    expect(engineRegistry.getDefinition('atr').plots).toHaveLength(1)
  })

  it('sets exactly the data the legacy block would have set', () => {
    const { F } = sync(ATR_INSTANCE, ATR_CS, ATR_BAND)
    const raw = computeATR(BARS, 14)
    const points = F.callsOf('setData')[0].args[0]
    expect(points).toEqual(raw.map(p => (
      Number.isFinite(p.value) ? { time: p.time, value: p.value } : { time: p.time })))
    expect(points.at(-1).value).toBeGreaterThan(0)
    expect(points[0].value).toBeUndefined()
  })

  it('makes NO other renderer call — the WHOLE call list is three entries', () => {
    const { F } = sync(ATR_INSTANCE, ATR_CS, ATR_BAND)
    expect(F.methodsUsed().sort()).toEqual(['addSeries', 'priceScale.applyOptions', 'setData'])
  })

  it('and the volume-overlay path puts it on pane 1 / left with the shipped scaleOptions', () => {
    const ctx = {
      paneMargins: {}, volOverlaySet: new Set(['atr']),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'atr' }, engineRegistry.getDefinition('atr'), ctx)).toEqual({
      paneIndex: 1, scaleId: 'left', autoscale: 'default',
      scaleOptions: {
        borderVisible: false, visible: true, autoScale: true,
        scaleMargins: { top: 0.12, bottom: 0.04 },
      },
    })
    const { F } = sync(ATR_INSTANCE, ATR_CS, null,
      { volOverlaySet: new Set(['atr']), volSeparatePane: true })
    expect(F.callsOf('addSeries')[0].args[2]).toBe(1)
    expect(opts(F).priceScaleId).toBe('left')
    expect(F.callsOf('priceScale.applyOptions')[0].args[0])
      .toEqual({ ...LEGACY_LEFT_AXIS, scaleMargins: { ...LEGACY_LEFT_AXIS.scaleMargins } })
  })

  it('a POOLED series is re-fed on a colour AND a period change (#2049)', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, cs: ATR_CS, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: { atr: ATR_BAND }, volOverlaySet: new Set(),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    })
    run(ATR_INSTANCE)
    run({ ...ATR_INSTANCE, inputs: { period: 21, color: '#00ff00' } })
    expect(F.count('addSeries')).toBe(1)
    expect(F.count('removeSeries')).toBe(0)
    const applied = F.callsOf('applyOptions').filter(c => c.on === 'series')
    expect(applied.at(-1).args[0].color).toBe('#00ff00')
    // …and the NUMBERS moved with the period, which is what tells a live compute
    // from a replay. A colour-only check cannot: periods appear in no option.
    //
    // ⚠️ MEASURED, NOT ASSUMED — AND THE OBVIOUS PROBE IS VACUOUS HERE. The
    // fixture's true range is constant, so ATR(14) and ATR(21) agree at the LAST
    // bar to the last bit (2.6000000000000085 both times) and a `.at(-1)`
    // comparison passes on a series that never recomputed. What genuinely moves
    // is the NaN head: the first computable bar is period-dependent.
    const setDataCalls = F.callsOf('setData')
    expect(setDataCalls).toHaveLength(2)
    const firstFinite = (pts) => pts.findIndex(p => Number.isFinite(p.value))
    expect(firstFinite(setDataCalls[0].args[0])).toBe(14)
    expect(firstFinite(setDataCalls[1].args[0]), 'the period did not reach the compute').toBe(21)
  })
})

describe('the two definitions\' legend declarations — asserted from BOTH sides', () => {
  it('ATR declares legendParams, so its chip prints the period in brackets', () => {
    const def = engineRegistry.getDefinition('atr')
    expect(def.meta.legendParams).toEqual(['period'])
    expect(def.plots[0].legend).toEqual({ decimals: 4 })
    // No `legend.label`: `meta.shortName` + the params make `ATR(14)`.
    expect(def.plots[0].legend.label).toBeUndefined()
    expect(def.meta.shortName).toBe('ATR')
  })

  it('stoch declares NONE — deliberately, because the shipped chips have no brackets', () => {
    const def = engineRegistry.getDefinition('stoch')
    // ⛔ THE ABSENCE IS THE ASSERTION. `legend.label` short-circuits
    // `legendParams` in `chipLabel`, so adding one here would be INERT today and
    // would silently start printing `%K(14, 3)` the day a label is dropped.
    expect(def.meta.legendParams).toBeUndefined()
    expect(def.plots.find(p => p.key === 'k').legend).toEqual({ label: '%K', decimals: 1 })
    expect(def.plots.find(p => p.key === 'd').legend).toEqual({ label: '%D', decimals: 1 })
  })

  it('the two guide plots bear no chip and no column — they are levels, not series', () => {
    const def = engineRegistry.getDefinition('stoch')
    const guides = def.plots.filter(p => p.style === 'hlines')
    expect(guides.map(p => p.key)).toEqual(['overbought', 'oversold'])
    expect(guides.map(p => p.levels)).toEqual([[80], [20]])
    for (const g of guides) expect(g.legend).toBeUndefined()
    expect(Object.keys(engineRegistry.computeFor(def, BARS, STOCH_INSTANCE.inputs)).sort())
      .toEqual(['d', 'k'])
  })
})
