import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { AUTOSCALE_EXCLUDE } from '../pool'
import { seriesOptionsForPlot, poolKey } from '../pool'
import * as engineRegistry from '../nativeRegistry'
import { computeParabolicSAR, computeIchimoku } from '../../indicators'

import { createFakeChart, makeBars } from './fakeChart'

// ─── THE FLIP-A CONTRACT FOR SAR AND ICHIMOKU (B5 Task 6) ───────────────────
//
// Written and run BEFORE `StockChart.jsx` is touched: every literal below is a
// VERBATIM copy of the shipped block's `addSeries` arguments
// (`StockChart.jsx:6431-6500` at `cb8b8136`), so a failure here is a
// definition-vs-shipped-block disagreement — the migration's pixel diff,
// arriving before the migration and for free.
//
// ⚠️ `toEqual` OVER THE FULL OPTION OBJECT, NEVER `toMatchObject`. A
// `toMatchObject` transcription passes with an extra `lastValueVisible: true`
// that puts an axis tag on the chart the hand-written block never drew.
//
// ⭐ SAR IS THE FIRST `markers` PLOT THE BINDER HAS EVER CREATED, and the pair is
// what makes this task's two definitions genuinely different from Task 5's:
//
//   · `poolKey('markers') === 'line'` — a `markers` plot is a LineSeries with
//     `lineWidth: 0` and point markers on, which is exactly what the shipped
//     block builds. So the pool can RE-PURPOSE a SAR series as any other line,
//     and `pool.js`'s own header records the MEASURED leak that goes with it:
//     `sar → rsi` left `pointMarkersVisible: true` behind, i.e. an RSI line with
//     a dot on every bar. The complete-key-set rule is what closes it, and the
//     case below asserts it on that exact pair.
//   · both are PRICE OVERLAYS on the CANDLES' shared scale, so
//     `autoscaleInfoProvider` is load-bearing here in a way no oscillator's is:
//     B3 Task 1 measured 38,491 changed pixels when a price overlay was allowed
//     to drive the main scale's autoscale.
//
// ⭐ AND ICHIMOKU IS FIVE PLOTS WITH THREE PRESERVED QUIRKS. `indicators.js`
// records all three deliberately: spanA and spanB are NOT forward-displaced (every
// other product draws the cloud 26 bars ahead), and chikou IS back-shifted 26
// bars. TRANSCRIBED, NOT CORRECTED — correcting any of them is a measured,
// owner-facing decision of the shape the MACD head-mask (88 px) and the VWAP
// session anchor (2,590 px) got, not a thing a migration does on the way past.

// ─── the literal transcription ──────────────────────────────────────────────
// `StockChart.jsx:6431-6500` at `cb8b8136`, verbatim. Do not "tidy" these —
// their whole value is that they are a copy of the shipped call.

/** `chart.addSeries(LineSeries, <this>)` — `:6435-6445`. `sarColor` was
 *  `cs.indicators?.sar?.color || '#ffeb3b'`, which for a merged blob was
 *  `CHART_DEFAULTS.indicators.sar.color` — the July value, and the definition's
 *  declared default since B5 Task 9 deleted that section. */
const LEGACY_SAR = {
  priceScaleId: 'right',
  color: '#ffeb3b',
  lineWidth: 0,
  pointMarkersVisible: true,
  pointMarkersRadius: 3,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}

/** `createIfNeeded(ref, opts)` at `:6464-6480` — the shared tail every one of the
 *  five Ichimoku series gets, spread AFTER the per-plot `opts`. */
const LEGACY_ICHI_SHARED = {
  priceScaleId: 'right',
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}

/** The five `createIfNeeded` calls, `:6476-6480`, in shipped creation order.
 *  ⚠️ The `|| 'rgba(76,175,80,0.5)'` fallbacks in that block are DEAD for a
 *  merged blob — `mergeChartSettings` always supplied `cs.indicators.ichimoku`,
 *  so the values that actually reached the renderer were the blob's.
 *
 *  ⭐⭐ B5 TASK 9 DELETED THAT SECTION, and these five colours are exactly what
 *  `nativeRegistry.test.js`' JULY table exists to keep honest: the values a July
 *  blob merged for an input it never declared now come from the DEFINITION. So
 *  they are read off the definition here — one source, and the two are asserted
 *  equal to their July values in that file. */
const ICHI_DEFAULT = Object.fromEntries(
  engineRegistry.getDefinition('ichimoku').inputs.map(i => [i.key, i.default]))
const LEGACY_ICHI = [
  { key: 'tenkan', color: ICHI_DEFAULT.tenkanColor, lineWidth: 1, lineStyle: 0 },
  { key: 'kijun', color: ICHI_DEFAULT.kijunColor, lineWidth: 1, lineStyle: 0 },
  { key: 'spanA', color: ICHI_DEFAULT.spanAColor, lineWidth: 1, lineStyle: 0 },
  { key: 'spanB', color: ICHI_DEFAULT.spanBColor, lineWidth: 1, lineStyle: 0 },
  // ⭐ THE ONLY PER-PLOT DIFFERENCE IN THE WHOLE BLOCK: chikou's `lineStyle: 2`.
  { key: 'chikou', color: ICHI_DEFAULT.chikouColor, lineWidth: 1, lineStyle: 2 },
]

/**
 * The options the engine states that the legacy blocks do NOT — each equal to
 * the value a freshly-created LWC 5.2.0 line series already has, so a CREATED
 * series is byte-identical and a RE-PURPOSED one is reset to it.
 *
 * ⚠️ `pointMarkersVisible: false` / `pointMarkersRadius: 3` are in here for
 * ICHIMOKU and NOT for SAR, and that asymmetry is the whole point of the
 * complete-key-set rule: SAR names both, so a series re-purposed out of SAR's
 * pool bucket has to be told to stop drawing dots.
 */
const LWC_LINE_DEFAULTS_RESTATED = {
  visible: true,
  lineType: 0,
  pointMarkersVisible: false,
  pointMarkersRadius: 3,
  priceFormat: { type: 'price', precision: 2 },
}

// ⭐ B5 TASK 12 — AND WHY THIS FILE ALONE NEEDS NO `__setPaneModeForTest`.
// Every sibling Flip-A suite pins `'bands'`, because `PANE_MODE` is `'panes'`
// now and an oscillator resolved under the default lands in a REAL pane on a
// `'right'` scale with zero margins. Both definitions here are PRICE OVERLAYS,
// and `resolvePlacement`'s `target === 'price'` branch returns before
// `paneMode()` is ever read — so these expectations are the SHIPPED answer in
// both modes, and pinning would only narrow what this file covers while
// claiming a mode-dependence it does not have. If a price overlay ever starts
// resolving differently per mode, this file goes red under the shipped default,
// which is the direction that should hurt.

// ─── the fixtures ───────────────────────────────────────────────────────────

const BARS = makeBars(260)

const SAR_INSTANCE = {
  instanceId: 'legacy:sar', defId: 'sar', defVersion: 1,
  inputs: { step: 0.02, maxStep: 0.2, color: '#ffeb3b' },
  placement: { target: 'price' }, hidden: false,
}

const ICHI_INSTANCE = {
  instanceId: 'legacy:ichimoku', defId: 'ichimoku', defVersion: 1,
  inputs: {
    tenkanColor: ICHI_DEFAULT.tenkanColor,
    kijunColor: ICHI_DEFAULT.kijunColor,
    spanAColor: ICHI_DEFAULT.spanAColor,
    spanBColor: ICHI_DEFAULT.spanBColor,
    chikouColor: ICHI_DEFAULT.chikouColor,
  },
  placement: { target: 'price' }, hidden: false,
}

const sync = (instances, over) => {
  const F = createFakeChart()
  const binder = createBinder({ chart: F.chart, LWC: F.LWC })
  const result = binder.sync({
    enabled: true, registry: engineRegistry,
    instances: Array.isArray(instances) ? instances : [instances],
    bars: BARS, adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
    paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    ...over,
  })
  return { F, binder, result }
}

const opts = (F, i = 0) => F.callsOf('addSeries')[i].args[1]
const plotFor = (defId, key) =>
  engineRegistry.getDefinition(defId).plots.find(p => p.key === key)
const asLegacyPoints = (pts) => pts.map(p => (
  Number.isFinite(p.value) ? { time: p.time, value: p.value } : { time: p.time }))

describe('sar transcription — the first markers plot the engine has ever bound', () => {
  it('lineWidth 0 + point markers is what a "markers" plot MEANS here', () => {
    // The shipped block draws SAR as a LineSeries with `lineWidth: 0` and visible
    // point markers, and `width: 3` on the plot is the DOT RADIUS, not a stroke.
    expect(poolKey(plotFor('sar', 'sar'))).toBe('line')
    expect(plotFor('sar', 'sar').style).toBe('markers')
    expect(plotFor('sar', 'sar').width).toBe(3)
    expect(seriesOptionsForPlot(plotFor('sar', 'sar'),
      { scaleId: 'right', autoscale: 'exclude', LineStyle: null, LineType: null }))
      .toEqual({
        ...LEGACY_SAR,
        visible: true,
        lineStyle: 0,
        lineType: 0,
        priceFormat: { type: 'price', precision: 2 },
        autoscaleInfoProvider: AUTOSCALE_EXCLUDE,
      })
  })

  it('and it is autoscale-EXCLUDED, like every price overlay', () => {
    // B3 Task 1's seam, and the most expensive one measured on this branch:
    // 38,491 changed pixels when a price overlay was allowed to drive the main
    // scale. SAR's dots run BELOW price in an uptrend and above it in a
    // downtrend, so they are exactly the shape that stretches a range.
    const ctx = { paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1 }
    const placed = resolvePlacement(SAR_INSTANCE, engineRegistry.getDefinition('sar'), ctx)
    expect(placed.autoscale).toBe('exclude')
    expect(placed).toEqual({ paneIndex: 0, scaleId: 'right', scaleOptions: null, autoscale: 'exclude' })
  })

  it('a pooled series re-purposed FROM sar does not keep its point markers', () => {
    // ⭐ THE COMPLETE-KEY-SET RULE, ON THE EXACT PAIR `pool.js` MEASURED. Both
    // plots have pool key `line`, so the pool really can hand SAR's series to
    // RSI; `applyOptions` MERGES and `merge()` SKIPS `undefined`, so an option
    // SAR named and RSI does not would survive as a dot on every RSI bar.
    expect(poolKey(plotFor('rsi', 'rsi'))).toBe(poolKey(plotFor('sar', 'sar')))
    const o = seriesOptionsForPlot(plotFor('rsi', 'rsi'), { scaleId: 'rsi', autoscale: 'default' })
    expect(o.pointMarkersVisible).toBe(false)
    expect(o.lineWidth).toBe(1)
    // …and the key SET is identical, which is what makes "reset by omission"
    // impossible rather than merely unused.
    expect(Object.keys(o).sort()).toEqual(
      Object.keys(seriesOptionsForPlot(plotFor('sar', 'sar'), { scaleId: 'right' })).sort())
  })

  it('creates ONE LineSeries in pane 0 with the shipped option object, key for key', () => {
    const { F, result } = sync(SAR_INSTANCE)
    expect(result.ok).toBe(true)
    expect(result.bound).toBe(1)
    expect(F.callsOf('addSeries')).toHaveLength(1)
    expect(F.callsOf('addSeries')[0].args[0]).toBe(F.LWC.LineSeries)
    expect(F.callsOf('addSeries')[0].args[2], 'a price overlay lives in pane 0').toBe(0)
    expect(opts(F)).toMatchObject(LEGACY_SAR)
    expect(opts(F)).toEqual({
      ...LEGACY_SAR,
      visible: true,
      lineStyle: 0,
      lineType: 0,
      priceFormat: { type: 'price', precision: 2 },
      autoscaleInfoProvider: AUTOSCALE_EXCLUDE,
    })
  })

  it('asserts NOTHING on the candles\' price scale', () => {
    // A price overlay is a GUEST on the axis the candles own; writing
    // `scaleMargins` there would move the candles.
    const { F } = sync(SAR_INSTANCE)
    expect(F.count('priceScale.applyOptions')).toBe(0)
    expect(F.methodsUsed().sort()).toEqual(['addSeries', 'setData'])
  })

  it('sets exactly the data the legacy block would have set — and drops isUptrend', () => {
    const { F } = sync(SAR_INSTANCE)
    const raw = computeParabolicSAR(BARS, 0.02, 0.2)
    const points = F.callsOf('setData')[0].args[0]
    expect(points).toEqual(asLegacyPoints(raw))
    // `isUptrend` rides on every SAR point (a preserved quirk — `indicators.js`
    // §2) and the shipped block strips it with `indPoint(p.time, p.value)`.
    expect(raw.some(p => p.isUptrend !== undefined), 'the quirk is still there to strip').toBe(true)
    expect(points.every(p => p.isUptrend === undefined)).toBe(true)
    // Non-vacuous at both ends.
    expect(points.at(-1).value).toBeGreaterThan(0)
    expect(points).toHaveLength(BARS.length)
  })

  it('the step reaches the compute — a knob that appears in NO option object', () => {
    // A colour perturbation cannot tell a live compute from a replay; `step` can.
    const { F } = sync({ ...SAR_INSTANCE, inputs: { ...SAR_INSTANCE.inputs, step: 0.04 } })
    const slow = F.callsOf('setData')[0].args[0]
    const fast = asLegacyPoints(computeParabolicSAR(BARS, 0.04, 0.2))
    expect(slow).toEqual(fast)
    expect(slow).not.toEqual(asLegacyPoints(computeParabolicSAR(BARS, 0.02, 0.2)))
  })

  it('a POOLED series is re-fed on a colour AND a step change, never recreated (#2049)', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    })
    run(SAR_INSTANCE)
    run({ ...SAR_INSTANCE, inputs: { ...SAR_INSTANCE.inputs, color: '#ff0000' } })
    run({ ...SAR_INSTANCE, inputs: { ...SAR_INSTANCE.inputs, color: '#ff0000', step: 0.04 } })
    expect(F.count('addSeries')).toBe(1)
    expect(F.count('removeSeries')).toBe(0)
    const applied = F.callsOf('applyOptions').filter(c => c.on === 'series')
    expect(applied.at(-1).args[0].color).toBe('#ff0000')
    expect(applied.at(-1).args[0].pointMarkersVisible, 'a re-bind re-asserts the dots').toBe(true)
    const setDataCalls = F.callsOf('setData')
    expect(setDataCalls).toHaveLength(3)
    expect(setDataCalls[2].args[0]).not.toEqual(setDataCalls[1].args[0])
  })
})

describe('ichimoku transcription — five plots, two chips, one shifted series', () => {
  it.each(LEGACY_ICHI.map((s, i) => [s.key, i]))(
    '%s: the full option object, key for key', (key, i) => {
      const { F } = sync(ICHI_INSTANCE)
      const spec = LEGACY_ICHI[i]
      expect(opts(F, i), key).toMatchObject({
        ...LEGACY_ICHI_SHARED, color: spec.color, lineWidth: spec.lineWidth,
      })
      expect(opts(F, i), key).toEqual({
        ...LEGACY_ICHI_SHARED,
        ...LWC_LINE_DEFAULTS_RESTATED,
        color: spec.color,
        lineWidth: spec.lineWidth,
        lineStyle: spec.lineStyle,
        autoscaleInfoProvider: AUTOSCALE_EXCLUDE,
      })
    })

  it('chikou is the dashed one and NOTHING else differs', () => {
    const { F } = sync(ICHI_INSTANCE)
    const styles = F.callsOf('addSeries').map(c => c.args[1].lineStyle)
    expect(styles).toEqual([0, 0, 0, 0, 2])
    // …and the rest of chikou's object is tenkan's, colour aside. Stated as a
    // difference SET rather than as five more toEquals, so a second divergence
    // cannot hide behind the one that is expected.
    const t = { ...opts(F, 0) }
    const c = { ...opts(F, 4) }
    // ⚠️ BY VALUE, NOT BY IDENTITY. `priceFormat` is a fresh object per bind, so
    // `!==` reports it as a difference on every plot and the assertion would be
    // about object identity rather than about what the renderer receives.
    const same = (a, b) => (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null)
      ? JSON.stringify(a) === JSON.stringify(b)
      : a === b
    const differing = Object.keys({ ...t, ...c }).filter(k => !same(t[k], c[k]))
    expect(differing.sort()).toEqual(['color', 'lineStyle'])
  })

  it('all five are autoscale-EXCLUDED — the shipped block passes () => null on every one', () => {
    const { F } = sync(ICHI_INSTANCE)
    const created = F.callsOf('addSeries')
    expect(created).toHaveLength(5)
    for (const call of created) {
      expect(call.args[1].autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
      expect(call.args[1].priceScaleId).toBe('right')
      expect(call.args[2]).toBe(0)
    }
    expect(F.count('priceScale.applyOptions'), 'a guest asserts nothing on the axis').toBe(0)
  })

  it('the five series are created in DECLARATION order, which is the shipped order', () => {
    // LWC z-stacks by insertion. The cloud edges must not swap: spanA over spanB
    // and spanB over spanA are different pictures wherever they cross.
    expect(engineRegistry.getDefinition('ichimoku').plots.map(p => p.key))
      .toEqual(['tenkan', 'kijun', 'spanA', 'spanB', 'chikou'])
    const { F, binder } = sync(ICHI_INSTANCE)
    expect(F.count('addSeries')).toBe(5)
    expect(binder.bindings().map(b => b.key))
      .toEqual(['legacy:ichimoku::tenkan', 'legacy:ichimoku::kijun',
        'legacy:ichimoku::spanA', 'legacy:ichimoku::spanB', 'legacy:ichimoku::chikou'])
  })

  it('sets exactly the data the legacy block would have set, on all five', () => {
    const { F } = sync(ICHI_INSTANCE)
    // ⚠️ `computeIchimoku(filteredBars)` — the LEGACY memo calls it with NO
    // arguments, so its three periods default to 9/26/52. The definition declares
    // the same three numbers, so the engine's `resolveInputs` produces the same
    // call. That equality is the whole reason this migration is 0 px.
    const raw = computeIchimoku(BARS)
    const setDataCalls = F.callsOf('setData')
    expect(setDataCalls).toHaveLength(5)
    for (const [i, key] of ['tenkan', 'kijun', 'spanA', 'spanB', 'chikou'].entries()) {
      expect(setDataCalls[i].args[0], key).toEqual(asLegacyPoints(raw[key]))
    }
    // Non-vacuous: real numbers somewhere in every column, whitespace at the head.
    for (const [i, key] of ['tenkan', 'kijun', 'spanA', 'spanB', 'chikou'].entries()) {
      expect(setDataCalls[i].args[0].some(p => Number.isFinite(p.value)), key).toBe(true)
      expect(setDataCalls[i].args[0][0].value, key).toBeUndefined()
    }
  })

  it('THREE PRESERVED QUIRKS — transcribed, not corrected', () => {
    // ⛔ `indicators.js` records all three deliberately. Correcting any of them is
    // a measured, owner-facing decision (the MACD head-mask at 88 px, the VWAP
    // session anchor at 2,590 px), never a thing a migration does in passing.
    const raw = computeIchimoku(BARS)
    const finite = (col) => col.map((p, i) => [i, p.value]).filter(([, v]) => Number.isFinite(v))

    // (1) + (2) spanA and spanB are NOT forward-displaced: they end on the LAST
    // bar, where every other product's cloud runs 26 bars past it.
    expect(finite(raw.spanA).at(-1)[0]).toBe(BARS.length - 1)
    expect(finite(raw.spanB).at(-1)[0]).toBe(BARS.length - 1)
    // …and spanA really is the tenkan/kijun midpoint at the SAME index, which is
    // what "not displaced" means arithmetically.
    const last = BARS.length - 1
    expect(raw.spanA[last].value).toBeCloseTo((raw.tenkan[last].value + raw.kijun[last].value) / 2, 12)

    // (3) chikou IS back-shifted by kijunPeriod (26), so its last 26 slots are
    // the NaN pad — the head is not the only place this column is blank.
    expect(finite(raw.chikou).at(-1)[0]).toBe(BARS.length - 1 - 26)
    expect(raw.chikou[last].value).toBeNaN()
    expect(raw.chikou[last - 26].value).toBe(BARS[last].c)
  })

  it('spanA, spanB and chikou declare NO legend block, explicitly', () => {
    const def = engineRegistry.getDefinition('ichimoku')
    const byKey = Object.fromEntries(def.plots.map(p => [p.key, p]))
    expect(byKey.tenkan.legend).toEqual({ label: 'TK', decimals: 2 })
    expect(byKey.kijun.legend).toEqual({ label: 'KJ', decimals: 2 })
    for (const key of ['spanA', 'spanB', 'chikou']) {
      expect(byKey[key].legend, `${key} must not gain a chip`).toBeUndefined()
    }
    // ⛔ THE ABSENCE IS THE ASSERTION on `legendParams` too: `meta.shortName` is
    // 'Ichimoku' and the shipped chips read `TK`/`KJ` with no brackets.
    expect(def.meta.legendParams).toBeUndefined()
    expect(def.meta.shortName).toBe('Ichimoku')
  })

  it('the three periods reach the compute, which is what makes them WIRED', () => {
    // ⭐ B5 Task 6, and it is the answer to a question the brief left open:
    // `CHART_DEFAULTS.indicators.ichimoku` carries no period, and the LEGACY memo
    // called `computeIchimoku(filteredBars)` with none — so the three declared
    // inputs were the ONLY greyed controls in the whole app. `computeIchimoku`
    // DOES honour its three arguments, and the engine passes the instance's, so
    // after the flip they are live controls that do something. They did not need
    // `activeWhen: false`; they needed a flip.
    const { F } = sync({ ...ICHI_INSTANCE, inputs: { ...ICHI_INSTANCE.inputs, tenkanPeriod: 18 } })
    const raw = computeIchimoku(BARS, 18, 26, 52)
    expect(F.callsOf('setData')[0].args[0]).toEqual(asLegacyPoints(raw.tenkan))
    expect(F.callsOf('setData')[0].args[0])
      .not.toEqual(asLegacyPoints(computeIchimoku(BARS).tenkan))
  })

  it('a POOLED five-series instance is re-fed on a restyle, never recreated (#2049)', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    })
    run(ICHI_INSTANCE)
    run({ ...ICHI_INSTANCE, inputs: { ...ICHI_INSTANCE.inputs, chikouColor: '#ff00ff', kijunPeriod: 30 } })
    expect(F.count('addSeries'), 'five in, five kept').toBe(5)
    expect(F.count('removeSeries')).toBe(0)
    const applied = F.callsOf('applyOptions').filter(c => c.on === 'series')
    expect(applied.some(c => c.args[0].color === '#ff00ff')).toBe(true)
    // The second pass re-asserts the COMPLETE option set, not a delta.
    expect(Object.keys(applied[0].args[0]).sort()).toEqual(Object.keys(opts(F, 0)).sort())
  })
})

describe('the price overlays keep their z-order across the migration', () => {
  it('bb, vwap, sar, ichimoku, donchian is the registry order, and it is legacy render order', () => {
    // ⭐ THE REASON THIS TASK CANNOT BE REORDERED WITH TASK 8. The engine draws
    // everything it owns contiguously at ONE call site, which sits where BB's
    // block was — i.e. BEFORE every remaining legacy block. So a LATER price
    // overlay migrated while an EARLIER one is still legacy is inserted ABOVE an
    // overlay it currently sits below, and LWC z-stacks by insertion.
    expect(engineRegistry.listDefinitions()
      .filter(d => d.placement?.target === 'price').map(d => d.id))
      .toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
  })

  it('the binder inserts them in registry order regardless of the instance list\'s order', () => {
    // The migrator walks the registry, so a stored list in another order is the
    // compatibility path — and it must not re-stack the overlays.
    const { binder } = sync([ICHI_INSTANCE, SAR_INSTANCE])
    expect(binder.bindings().map(b => b.key).filter(k => !k.includes('span') && !k.includes('chikou')))
      .toEqual(['legacy:ichimoku::tenkan', 'legacy:ichimoku::kijun', 'legacy:sar::sar'])
  })
})
