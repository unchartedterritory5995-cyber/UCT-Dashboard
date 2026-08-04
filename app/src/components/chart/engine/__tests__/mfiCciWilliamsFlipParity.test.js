import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { AUTOSCALE_DEFAULT } from '../pool'
import * as engineRegistry from '../nativeRegistry'
import { computeMFI, computeCCI, computeWilliamsR } from '../../indicators'
import { computePaneMargins } from '../../paneMargins'
import { createFakeChart, makeBars } from './fakeChart'

// ─── THE FLIP-A CONTRACT FOR MFI, CCI AND WILLIAMS %R (B5 Task 7) ────────────
//
// Written and run BEFORE `StockChart.jsx` is touched: every literal below is a
// VERBATIM copy of the shipped block's `addSeries` / `applyIndScale` /
// `createPriceLine` arguments (`StockChart.jsx:6451-6522` at `ebfec13f`), so a
// failure here is a definition-vs-shipped-block disagreement — the migration's
// pixel diff, arriving before the migration and for free. It passed on the
// un-migrated tree and must keep passing on the migrated one.
//
// ⚠️ `toEqual` OVER THE FULL OPTION OBJECT, NEVER `toMatchObject`. A
// `toMatchObject` transcription passes with an extra `lastValueVisible: true`
// that puts an axis tag on the chart the hand-written block never drew.
//
// ⭐ THESE THREE ARE STRUCTURALLY IDENTICAL — one line plot plus `hlines` guides
// — WHICH IS EXACTLY WHY THEIR DIFFERENCES ARE ALL IN THE GUIDES AND THE SCALE,
// and that is where a transcription error hides. Three guide shapes, three
// scales:
//
//   · `mfi`       `fixedPane(0, 100)`   two guides at 80 / 20, one style
//   · `cci`       `autoPane`            THREE guides in TWO styles — ±100 dashed
//                                       plus a LARGE-dashed zero line. It is the
//                                       only definition in the registry with two
//                                       guide STYLES, and the only unbounded one
//                                       of the three.
//   · `williamsR` `fixedPane(-100, 0)`  two guides at −20 / −80 on a NEGATIVE
//                                       scale, with a snake_case plot key.
//
// ⚠️ AND A `createPriceLine` OPTION IS NOT A SERIES OPTION. An omitted SERIES
// option means "keep what's there"; an omitted `createPriceLine` option means
// LWC's OWN DEFAULT, which for `lineStyle` is Dashed (2). That asymmetry cost
// 379 changed pixels on RSI's 50-midline at B3, and `cci`'s zero line is the
// one place in this file where the two styles are adjacent — a dropped
// `largeDashed` would silently become the SAME dash as the ±100 bands and no
// series-option assertion could see it.
//
// ⛔ NO `title` KEY ON ANY GUIDE. The shipped `createPriceLine` calls state
// none, and adding one draws a label the hand-written block never drew. (The
// brief's `GUIDE` helper writes `title: ''`; Task 5 measured that the shipped
// calls never pass it, and the same holds for all seven guides here.)

// ─── the literal transcription ──────────────────────────────────────────────
// `StockChart.jsx:6451-6522` at `ebfec13f`, verbatim. Do not "tidy" these —
// their whole value is that they are a copy of the shipped call.

/** `chart.addSeries(LineSeries, <this>, mfiTgt.pane)` — `:6456-6461`. */
const LEGACY_MFI = {
  priceScaleId: 'mfi',
  color: '#c084fc',
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}

/** `:6480-6485`. */
const LEGACY_CCI = {
  ...LEGACY_MFI,
  priceScaleId: 'cci',
  color: '#fbbf24',
}

/** `:6505-6510`. */
const LEGACY_WILLIAMS = {
  ...LEGACY_MFI,
  priceScaleId: 'williamsR',
  color: '#60a5fa',
}

/**
 * The options the engine states that the legacy blocks do NOT — each equal to
 * the value a freshly-created LWC 5.2.0 line series already has, so a CREATED
 * series is byte-identical and a RE-PURPOSED one is reset to it.
 *
 * The complete-key-set rule (`pool.seriesOptionsForPlot`) is why they exist:
 * `applyOptions` MERGES and `merge()` SKIPS `undefined`, so an option a plot
 * does not name survives from the previous tenant. `stoch.d → mfi.mfi` leaking
 * `lineStyle: 2` is a MEASURED example in that module's header, and `mfi` is
 * the RECEIVING half of it — a dashed MFI line is the picture that pair draws.
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

/** ⛔ NO `title`: the shipped calls state none. Every other key IS stated,
 *  because an omitted one takes LWC's default rather than "keep what's there". */
const guide = (price, color, lineStyle) => (
  { price, color, lineWidth: 1, lineStyle, axisLabelVisible: false })

/** `mfiSeriesRef.current.createPriceLine(<these>)` — `:6463-6464`. */
const LEGACY_MFI_GUIDES = [
  guide(80, 'rgba(192,132,252,0.4)', 2),
  guide(20, 'rgba(192,132,252,0.4)', 2),
]

/**
 * `cciSeriesRef.current.createPriceLine(<these>)` — `:6487-6489`, IN THE ORDER
 * THE ENGINE EMITS THEM.
 *
 * ⚠️ THE SHIPPED BLOCK'S ORDER IS `100, 0, -100`; THE ENGINE'S IS `100, -100,
 * 0`, and that is a transcription FINDING rather than a defect. The engine
 * walks plots in declaration order and each plot's `levels` in array order, so
 * the two-level `bands` plot emits both of its lines before the one-level
 * `zero` plot emits its own. Three horizontal lines at three distinct prices
 * never overlap, so insertion order is invisible in the picture — but stating
 * the shipped order here would have made this case RED for a reason that has no
 * pixel behind it, and stating it silently would have hidden a real reorder.
 * The `zero` line's identity is asserted by its STYLE and COLOUR below, not by
 * its position in this list.
 */
const LEGACY_CCI_GUIDES = [
  guide(100, 'rgba(251,191,36,0.4)', 2),
  guide(-100, 'rgba(251,191,36,0.4)', 2),
  guide(0, 'rgba(251,191,36,0.2)', 3),
]

/** `williamsRSeriesRef.current.createPriceLine(<these>)` — `:6512-6513`. */
const LEGACY_WILLIAMS_GUIDES = [
  guide(-20, 'rgba(96,165,250,0.4)', 2),
  guide(-80, 'rgba(96,165,250,0.4)', 2),
]

// ─── the fixtures ───────────────────────────────────────────────────────────

const BARS = makeBars(260)

const MFI_INSTANCE = {
  instanceId: 'legacy:mfi', defId: 'mfi', defVersion: 1,
  inputs: { period: 14, color: '#c084fc' },
  placement: { target: 'pane' }, hidden: false,
}

const CCI_INSTANCE = {
  instanceId: 'legacy:cci', defId: 'cci', defVersion: 1,
  inputs: { period: 20, color: '#fbbf24' },
  placement: { target: 'pane' }, hidden: false,
}

const WILLIAMS_INSTANCE = {
  instanceId: 'legacy:williamsR', defId: 'williamsR', defVersion: 1,
  inputs: { period: 14, color: '#60a5fa' },
  placement: { target: 'pane' }, hidden: false,
}

/** The `cs` each parity case pins. Its ONLY job is to feed `computePaneMargins`,
 *  which is what reserves the band the engine has to render into. */
const MFI_CS = { indicators: { mfi: { enabled: true, period: 14, color: '#c084fc' } } }
const CCI_CS = { indicators: { cci: { enabled: true, period: 20, color: '#fbbf24' } } }
const WILLIAMS_CS = { indicators: { williamsR: { enabled: true, period: 14, color: '#60a5fa' } } }
const MFI_BAND = computePaneMargins(MFI_CS, false, new Set()).mfi
const CCI_BAND = computePaneMargins(CCI_CS, false, new Set()).cci
const WILLIAMS_BAND = computePaneMargins(WILLIAMS_CS, false, new Set()).williamsR

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
const asLegacyPoints = (pts) => pts.map(p => (
  Number.isFinite(p.value) ? { time: p.time, value: p.value } : { time: p.time }))

/**
 * The `hlines` guide specs one definition would create, in the order the binder
 * creates them.
 *
 * ⛔ THROWS BY NAME on a definition that has no guides, rather than returning
 * `[]`. B4 measured a "throws by name on zero matches" guarantee that was
 * simply false, and a helper that loops over nothing turns every guide
 * assertion below into `expect([]).toEqual([])` — green, and about nothing.
 */
const guidesFor = (defId) => {
  const def = engineRegistry.getDefinition(defId)
  if (!def) throw new Error(`guidesFor: no definition named ${String(defId)}`)
  const { F } = sync(
    { instanceId: `probe:${defId}`, defId, defVersion: 1, inputs: {}, placement: { target: 'pane' }, hidden: false },
    { indicators: { [defId]: { enabled: true } } }, null)
  const made = F.callsOf('createPriceLine').map(c => c.args[0])
  if (made.length === 0) {
    throw new Error(
      `guidesFor: ${defId} created ZERO price lines. Either the definition declares no ` +
      '`hlines` plot, or the instance never bound — an empty list would make every ' +
      'guide assertion in this file vacuously green.')
  }
  return made
}

// ─── the three transcriptions ───────────────────────────────────────────────

describe('the three single-line oscillators, transcribed', () => {
  it('⛔ guidesFor THROWS BY NAME on a miss — it never loops over nothing', () => {
    // ⛔ THE HELPER'S OWN GATE, AND IT IS NOT CEREMONY. B4 measured a "throws by
    // name on zero matches" guarantee that was simply FALSE, and a `guidesFor`
    // that answered `[]` would turn every guide assertion in this file into a
    // comparison against an empty list — green, and about nothing. Both misses
    // are covered: an id the registry does not know, and a real definition that
    // declares no `hlines` plot at all (`atr` is the one).
    expect(() => guidesFor('mfiX')).toThrow(/no definition named mfiX/)
    expect(() => guidesFor('atr')).toThrow(/created ZERO price lines/)
    // …and the control that the helper WORKS, so the two throws above are not
    // simply "this helper always throws".
    expect(guidesFor('mfi')).toHaveLength(2)
  })

  it('reserves a band for each, and all three are the SAME 0.15-height band', () => {
    // Non-vacuity for every scale assertion below, and the one place these three
    // genuinely are symmetric: `paneMargins.PANES` gives cci, williamsR and mfi
    // `baseH: 0.15`, so alone each one reserves the top-0.85 band. (`atr`'s 0.13
    // is what made Task 5's pair asymmetric; here the asymmetry is elsewhere.)
    expect(MFI_BAND).toEqual({ top: 0.85, bottom: 0 })
    expect(CCI_BAND).toEqual({ top: 0.85, bottom: 0 })
    expect(WILLIAMS_BAND).toEqual({ top: 0.85, bottom: 0 })
    for (const id of ['mfi', 'cci', 'williamsR']) {
      expect(engineRegistry.getDefinition(id).placement.pane.height, id).toBe(0.15)
    }
  })

  it('mfi: two guides at 80 and 20, on a 0-100 PINNED scale', () => {
    expect(guidesFor('mfi')).toEqual(LEGACY_MFI_GUIDES)
    const ctx = {
      paneMargins: computePaneMargins(MFI_CS, true, new Set()),
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'mfi' }, engineRegistry.getDefinition('mfi'), ctx).scaleOptions)
      .toEqual({
        borderVisible: false, scaleMargins: ctx.paneMargins.mfi,
        autoScale: false, minimum: 0, maximum: 100,
      })
  })

  it('cci: THREE guides, and the zero line is largeDashed while the bands are not', () => {
    // ⛔ An omitted `createPriceLine` option means LWC's DEFAULT, not "keep what's
    // there". RSI's 50-line cost 379 changed pixels on exactly this distinction,
    // and cci is the ONLY definition in the registry with two guide STYLES.
    const guides = guidesFor('cci')
    expect(guides).toEqual(LEGACY_CCI_GUIDES)
    // …stated a second way, by STYLE rather than by position, so a reorder of
    // the list above cannot quietly move the dash onto a band.
    const byPrice = Object.fromEntries(guides.map(g => [g.price, g]))
    expect(byPrice[0].lineStyle, 'the zero line lost its LargeDashed').toBe(3)
    expect(byPrice[100].lineStyle).toBe(2)
    expect(byPrice[-100].lineStyle).toBe(2)
    expect(byPrice[0].color, 'the zero line is the FAINT one (0.2 alpha)').toBe('rgba(251,191,36,0.2)')
    expect(new Set(guides.map(g => g.lineStyle)), 'cci is the two-style definition').toEqual(new Set([2, 3]))
    // ⛔ AND THE ZERO LEVEL SURVIVES A FALSY-CHECK TRAP. `0` is the only guide
    // level in the whole registry that is falsy; a filter written `if (!price)`
    // instead of `Number.isFinite(price)` drops exactly this line and nothing
    // else in the file would notice.
    expect(guides.map(g => g.price)).toContain(0)
  })

  it('cci is autoScale TRUE — it is the only unbounded one of the three', () => {
    const ctx = {
      paneMargins: computePaneMargins(CCI_CS, true, new Set()),
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    }
    const placed = resolvePlacement({ defId: 'cci' }, engineRegistry.getDefinition('cci'), ctx)
    expect(placed.scaleOptions).toEqual({
      borderVisible: false, scaleMargins: ctx.paneMargins.cci, autoScale: true,
    })
    expect(placed.scaleOptions.minimum, 'cci must not inherit a fixed range').toBeUndefined()
    expect(engineRegistry.getDefinition('cci').placement.scale).toBeUndefined()
  })

  it('williamsR: the scale is -100..0, NOT 0..100, and the plot key is snake_case', () => {
    // The registry key is `williams_r` while the SETTINGS key is `williamsR`.
    // A migration that quietly harmonised them binds nothing and reports 0 px,
    // because a definition with no matching column produces no data.
    expect(engineRegistry.getDefinition('williamsR').plots.map(p => p.key))
      .toEqual(['williams_r', 'bands'])
    const ctx = {
      paneMargins: computePaneMargins(WILLIAMS_CS, true, new Set()),
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'williamsR' }, engineRegistry.getDefinition('williamsR'), ctx).scaleOptions)
      .toEqual({
        borderVisible: false, scaleMargins: ctx.paneMargins.williamsR,
        autoScale: false, minimum: -100, maximum: 0,
      })
    expect(guidesFor('williamsR')).toEqual(LEGACY_WILLIAMS_GUIDES)
  })

  it('⭐ THE NEGATIVE SCALE NEEDS `Number.isFinite`, NOT TRUTHINESS — max is 0', () => {
    // ⚠️ THE ONE THING williamsR'S SCALE ACTUALLY NEEDS, and it is invisible in
    // any symmetry argument with `mfi`. `resolvePlacement` picks the pinned
    // branch on `Number.isFinite(scale.min) && Number.isFinite(scale.max)`.
    // williamsR's `max` is 0 and mfi's `min` is 0 — BOTH FALSY — so a
    // `scale.min && scale.max` guard sends both of them down the `autoScale:
    // true` branch instead. That is not a cosmetic difference: `autoScale:false`
    // is the half of the declaration the renderer actually honours (it freezes
    // the range against re-invalidation), so losing it is the pooled-scale
    // hazard `placement.js`'s TRAP #2 exists for.
    const wr = engineRegistry.getDefinition('williamsR').placement.scale
    const mfi = engineRegistry.getDefinition('mfi').placement.scale
    expect(wr).toEqual({ min: -100, max: 0 })
    expect(mfi).toEqual({ min: 0, max: 100 })
    expect(Boolean(wr.max), 'williamsR.max is FALSY — this is the trap').toBe(false)
    expect(Boolean(mfi.min), 'mfi.min is FALSY too').toBe(false)
    expect(Number.isFinite(wr.max) && Number.isFinite(mfi.min)).toBe(true)
    // …and it reaches the RENDERER, not just the resolver.
    const { F } = sync(WILLIAMS_INSTANCE, WILLIAMS_CS, WILLIAMS_BAND)
    expect(F.callsOf('priceScale.applyOptions')[0].args[0])
      .toEqual(legacyBandScale(WILLIAMS_BAND, { autoScale: false, minimum: -100, maximum: 0 }))
  })

  it('and none of the three declares a legend block, so none adds a chip', () => {
    for (const id of ['mfi', 'cci', 'williamsR']) {
      expect(engineRegistry.getDefinition(id).plots.filter(p => p.legend), id).toEqual([])
      expect(engineRegistry.getDefinition(id).meta.legendParams, id).toBeUndefined()
    }
    // The control that this assertion CAN fail: rsi DOES declare one.
    expect(engineRegistry.getDefinition('rsi').plots.filter(p => p.legend)).toHaveLength(1)
  })
})

// ─── per-definition renderer transcription ──────────────────────────────────

describe('mfi transcription — what the shipped block hands the renderer', () => {
  it('creates ONE LineSeries in pane 0 with the shipped option object, key for key', () => {
    const { F, result } = sync(MFI_INSTANCE, MFI_CS, MFI_BAND)
    expect(result.ok).toBe(true)
    expect(result.bound).toBe(1)
    const created = F.callsOf('addSeries')
    expect(created).toHaveLength(1)
    expect(created[0].args[0]).toBe(F.LWC.LineSeries)
    // Flip A draws into a BAND inside pane 0, not a real pane. A `1` here is the
    // B5 geometry arriving early, and it would move every other series.
    expect(created[0].args[2]).toBe(0)
    expect(opts(F)).toMatchObject(LEGACY_MFI)
    expect(opts(F)).toEqual({ ...LEGACY_MFI, ...LWC_LINE_DEFAULTS_RESTATED })
  })

  it('asserts the FULL price-scale set — the band AND the 0-100 fixed range', () => {
    const { F } = sync(MFI_INSTANCE, MFI_CS, MFI_BAND)
    const scaleCalls = F.callsOf('priceScale.applyOptions')
    expect(scaleCalls).toHaveLength(1)
    expect(scaleCalls[0].args[0]).toEqual(
      legacyBandScale(MFI_BAND, { autoScale: false, minimum: 0, maximum: 100 }))
  })

  it('the two guides land on the MFI line itself, with EVERY key stated', () => {
    const { F } = sync(MFI_INSTANCE, MFI_CS, MFI_BAND)
    const lines = F.callsOf('createPriceLine')
    expect(lines).toHaveLength(2)
    expect(lines.map(c => c.args[0])).toEqual(LEGACY_MFI_GUIDES)
    const mfiSeries = F.seriesCreated[0]
    for (const c of lines) expect(c.id).toBe(mfiSeries.__id)
    // ⛔ NO `title` — the shipped calls state none, and LWC draws a label for one.
    for (const c of lines) expect('title' in c.args[0], 'a guide gained a title').toBe(false)
  })

  it('sets exactly the data the legacy block would have set', () => {
    const { F } = sync(MFI_INSTANCE, MFI_CS, MFI_BAND)
    const points = F.callsOf('setData')[0].args[0]
    expect(points).toEqual(asLegacyPoints(computeMFI(BARS, 14)))
    // Non-vacuous at both ends: real numbers at the tail, whitespace at the head.
    expect(points.at(-1).value).toBeGreaterThan(0)
    expect(points[0].value).toBeUndefined()
    expect(points).toHaveLength(BARS.length)
  })

  it('makes NO other renderer call', () => {
    const { F } = sync(MFI_INSTANCE, MFI_CS, MFI_BAND)
    expect(F.methodsUsed().sort()).toEqual(
      ['addSeries', 'createPriceLine', 'priceScale.applyOptions', 'setData'])
  })

  it('and the volume-overlay path puts it on pane 1 / left with the shipped scaleOptions', () => {
    // ⚠️ A PANE OSCILLATOR THE VOLUME-OVERLAY TOGGLE CAN MOVE, which the two
    // price overlays of Task 6 could not — so this pair of assertions is live
    // again, and the fixed 0-100 range must NOT follow it onto the shared axis.
    const ctx = {
      paneMargins: {}, volOverlaySet: new Set(['mfi']),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'mfi' }, engineRegistry.getDefinition('mfi'), ctx)).toEqual({
      paneIndex: 1, scaleId: 'left', autoscale: 'default',
      scaleOptions: { ...LEGACY_LEFT_AXIS, scaleMargins: { ...LEGACY_LEFT_AXIS.scaleMargins } },
    })
    const { F } = sync(MFI_INSTANCE, MFI_CS, null,
      { volOverlaySet: new Set(['mfi']), volSeparatePane: true })
    expect(F.callsOf('addSeries')[0].args[2]).toBe(1)
    expect(opts(F).priceScaleId).toBe('left')
    const applied = F.callsOf('priceScale.applyOptions')[0].args[0]
    expect(applied).toEqual({ ...LEGACY_LEFT_AXIS, scaleMargins: { ...LEGACY_LEFT_AXIS.scaleMargins } })
    expect(applied.minimum, 'the shared left axis must not inherit mfi\'s 0-100').toBeUndefined()
  })

  it('a POOLED series is re-fed on a colour AND a period change, never recreated (#2049)', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, cs: MFI_CS, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: { mfi: MFI_BAND }, volOverlaySet: new Set(),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    })
    run(MFI_INSTANCE)
    run({ ...MFI_INSTANCE, inputs: { period: 14, color: '#ff0000' } })
    run({ ...MFI_INSTANCE, inputs: { period: 21, color: '#ff0000' } })
    expect(F.count('addSeries'), 'a restyle or a period change must not create a second series').toBe(1)
    expect(F.count('removeSeries'), 'a restyle must not destroy the series').toBe(0)
    const applied = F.callsOf('applyOptions').filter(c => c.on === 'series')
    expect(applied.at(-1).args[0].color).toBe('#ff0000')
    // The second pass re-asserts the COMPLETE option set, not a delta.
    expect(Object.keys(applied[0].args[0]).sort()).toEqual(Object.keys(opts(F, 0)).sort())
    // …and the NUMBERS moved with the period, which is what tells a live compute
    // from a replay. A colour-only check cannot: a period appears in NO option.
    // ⚠️ MEASURED AT THE NaN HEAD, not at `.at(-1)`: Task 5 found the obvious
    // tail probe VACUOUS for ATR on this fixture (ATR(14) === ATR(21) at the last
    // bar to the last bit), and the first computable bar is period-dependent by
    // construction for every one of these three.
    const setDataCalls = F.callsOf('setData')
    expect(setDataCalls).toHaveLength(3)
    const firstFinite = (pts) => pts.findIndex(p => Number.isFinite(p.value))
    expect(firstFinite(setDataCalls[0].args[0])).toBe(14)
    expect(firstFinite(setDataCalls[2].args[0]), 'the period did not reach the compute').toBe(21)
    expect(setDataCalls[2].args[0]).not.toEqual(setDataCalls[1].args[0])
  })
})

describe('cci transcription — the AUTOSCALED band with two guide styles', () => {
  it('creates ONE LineSeries in pane 0 with the shipped option object, key for key', () => {
    const { F, result } = sync(CCI_INSTANCE, CCI_CS, CCI_BAND)
    expect(result.bound).toBe(1)
    const created = F.callsOf('addSeries')
    expect(created).toHaveLength(1)
    expect(created[0].args[0]).toBe(F.LWC.LineSeries)
    expect(created[0].args[2]).toBe(0)
    expect(opts(F)).toMatchObject(LEGACY_CCI)
    expect(opts(F)).toEqual({ ...LEGACY_CCI, ...LWC_LINE_DEFAULTS_RESTATED })
  })

  it('one autoScale:true scale call, with NO inherited fixed range', () => {
    const { F } = sync(CCI_INSTANCE, CCI_CS, CCI_BAND)
    const scaleCalls = F.callsOf('priceScale.applyOptions')
    expect(scaleCalls).toHaveLength(1)
    expect(scaleCalls[0].args[0]).toEqual(legacyBandScale(CCI_BAND, { autoScale: true }))
    expect(scaleCalls[0].args[0].minimum).toBeUndefined()
    expect(scaleCalls[0].args[0].maximum).toBeUndefined()
  })

  it('THREE guides on the CCI line, two dashed bands and one large-dashed zero', () => {
    const { F } = sync(CCI_INSTANCE, CCI_CS, CCI_BAND)
    const lines = F.callsOf('createPriceLine')
    expect(lines).toHaveLength(3)
    expect(lines.map(c => c.args[0])).toEqual(LEGACY_CCI_GUIDES)
    const cciSeries = F.seriesCreated[0]
    for (const c of lines) expect(c.id).toBe(cciSeries.__id)
    for (const c of lines) expect('title' in c.args[0]).toBe(false)
  })

  it('sets exactly the data the legacy block would have set', () => {
    const { F } = sync(CCI_INSTANCE, CCI_CS, CCI_BAND)
    const points = F.callsOf('setData')[0].args[0]
    expect(points).toEqual(asLegacyPoints(computeCCI(BARS, 20)))
    expect(points.some(p => Number.isFinite(p.value))).toBe(true)
    expect(points[0].value).toBeUndefined()
    expect(points).toHaveLength(BARS.length)
  })

  it('makes NO other renderer call', () => {
    const { F } = sync(CCI_INSTANCE, CCI_CS, CCI_BAND)
    expect(F.methodsUsed().sort()).toEqual(
      ['addSeries', 'createPriceLine', 'priceScale.applyOptions', 'setData'])
  })

  it('and the volume-overlay path puts it on pane 1 / left', () => {
    const ctx = {
      paneMargins: {}, volOverlaySet: new Set(['cci']),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'cci' }, engineRegistry.getDefinition('cci'), ctx)).toEqual({
      paneIndex: 1, scaleId: 'left', autoscale: 'default',
      scaleOptions: { ...LEGACY_LEFT_AXIS, scaleMargins: { ...LEGACY_LEFT_AXIS.scaleMargins } },
    })
    const { F } = sync(CCI_INSTANCE, CCI_CS, null,
      { volOverlaySet: new Set(['cci']), volSeparatePane: true })
    expect(F.callsOf('addSeries')[0].args[2]).toBe(1)
    expect(opts(F).priceScaleId).toBe('left')
  })

  it('a POOLED series is re-fed on a period change; the guides are NOT churned (#2049)', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, cs: CCI_CS, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: { cci: CCI_BAND }, volOverlaySet: new Set(),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    })
    run(CCI_INSTANCE)
    run({ ...CCI_INSTANCE, inputs: { period: 40, color: '#00ff00' } })
    expect(F.count('addSeries')).toBe(1)
    expect(F.count('removeSeries')).toBe(0)
    // ⚠️ THE GUIDE SIGNATURE DID NOT MOVE — ±100 and 0 are literals, not inputs —
    // so the three price lines are NOT removed and recreated on a restyle. LWC
    // has no "update a price line"; churning them every pass is the cost this
    // signature comparison exists to avoid.
    expect(F.count('createPriceLine'), 'the guides were recreated on a restyle').toBe(3)
    expect(F.count('removePriceLine')).toBe(0)
    const setDataCalls = F.callsOf('setData')
    const firstFinite = (pts) => pts.findIndex(p => Number.isFinite(p.value))
    expect(firstFinite(setDataCalls[0].args[0])).toBe(19)
    expect(firstFinite(setDataCalls[1].args[0]), 'the period did not reach the compute').toBe(39)
  })
})

describe('williamsR transcription — the NEGATIVE scale and the snake_case key', () => {
  it('creates ONE LineSeries in pane 0 with the shipped option object, key for key', () => {
    const { F, result } = sync(WILLIAMS_INSTANCE, WILLIAMS_CS, WILLIAMS_BAND)
    expect(result.bound).toBe(1)
    const created = F.callsOf('addSeries')
    expect(created).toHaveLength(1)
    expect(created[0].args[0]).toBe(F.LWC.LineSeries)
    expect(created[0].args[2]).toBe(0)
    expect(opts(F)).toMatchObject(LEGACY_WILLIAMS)
    expect(opts(F)).toEqual({ ...LEGACY_WILLIAMS, ...LWC_LINE_DEFAULTS_RESTATED })
    // ⭐ THE SCALE ID IS THE SETTINGS KEY, `williamsR` — camelCase — while the
    // PLOT key is `williams_r`. The scale is named after the DEFINITION id, the
    // column after the compute's output key, and the two are deliberately
    // different spellings of one indicator.
    expect(opts(F).priceScaleId).toBe('williamsR')
    expect(F.callsOf('addSeries')[0].args[1].priceScaleId).not.toBe('williams_r')
  })

  it('the binding key is `legacy:williamsR::williams_r` — BOTH spellings, one series', () => {
    // A migration that "harmonised" the two would bind nothing: `computeFor`
    // returns a column named `williams_r`, and a plot key that no longer matches
    // it produces no data, no series and a parity case reading 0 px because
    // NEITHER side draws.
    const { binder } = sync(WILLIAMS_INSTANCE, WILLIAMS_CS, WILLIAMS_BAND)
    expect(binder.bindings().map(b => b.key)).toEqual(['legacy:williamsR::williams_r'])
    expect(Object.keys(engineRegistry.computeFor(
      engineRegistry.getDefinition('williamsR'), BARS, { period: 14 }))).toEqual(['williams_r'])
  })

  it('asserts the FULL price-scale set — the band AND the -100..0 fixed range', () => {
    const { F } = sync(WILLIAMS_INSTANCE, WILLIAMS_CS, WILLIAMS_BAND)
    const scaleCalls = F.callsOf('priceScale.applyOptions')
    expect(scaleCalls).toHaveLength(1)
    expect(scaleCalls[0].args[0]).toEqual(
      legacyBandScale(WILLIAMS_BAND, { autoScale: false, minimum: -100, maximum: 0 }))
    expect(scaleCalls[0].args[0].minimum, 'the range is NEGATIVE, not mfi\'s 0..100').toBe(-100)
    expect(scaleCalls[0].args[0].maximum).toBe(0)
  })

  it('the two guides are at -20 and -80 — negative, and in that order', () => {
    const { F } = sync(WILLIAMS_INSTANCE, WILLIAMS_CS, WILLIAMS_BAND)
    const lines = F.callsOf('createPriceLine')
    expect(lines).toHaveLength(2)
    expect(lines.map(c => c.args[0])).toEqual(LEGACY_WILLIAMS_GUIDES)
    const wrSeries = F.seriesCreated[0]
    for (const c of lines) expect(c.id).toBe(wrSeries.__id)
    for (const c of lines) expect('title' in c.args[0]).toBe(false)
    // …and they are inside the declared range, which is what makes them visible.
    for (const c of lines) {
      expect(c.args[0].price).toBeLessThan(0)
      expect(c.args[0].price).toBeGreaterThan(-100)
    }
  })

  it('sets exactly the data the legacy block would have set — all of it negative', () => {
    const { F } = sync(WILLIAMS_INSTANCE, WILLIAMS_CS, WILLIAMS_BAND)
    const points = F.callsOf('setData')[0].args[0]
    expect(points).toEqual(asLegacyPoints(computeWilliamsR(BARS, 14)))
    expect(points.at(-1).value).toBeLessThanOrEqual(0)
    expect(points[0].value).toBeUndefined()
    expect(points).toHaveLength(BARS.length)
    // ⭐ NON-VACUITY FOR THE NEGATIVE-SCALE CLAIM: every computed value really is
    // in [-100, 0], so the range is the column's range and not a decoration.
    const finite = points.map(p => p.value).filter(Number.isFinite)
    expect(finite.length).toBeGreaterThan(200)
    expect(Math.max(...finite)).toBeLessThanOrEqual(0)
    expect(Math.min(...finite)).toBeGreaterThanOrEqual(-100)
  })

  it('makes NO other renderer call', () => {
    const { F } = sync(WILLIAMS_INSTANCE, WILLIAMS_CS, WILLIAMS_BAND)
    expect(F.methodsUsed().sort()).toEqual(
      ['addSeries', 'createPriceLine', 'priceScale.applyOptions', 'setData'])
  })

  it('and the volume-overlay path puts it on pane 1 / left, DROPPING the negative range', () => {
    const ctx = {
      paneMargins: {}, volOverlaySet: new Set(['williamsR']),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'williamsR' }, engineRegistry.getDefinition('williamsR'), ctx)).toEqual({
      paneIndex: 1, scaleId: 'left', autoscale: 'default',
      scaleOptions: { ...LEGACY_LEFT_AXIS, scaleMargins: { ...LEGACY_LEFT_AXIS.scaleMargins } },
    })
    const { F } = sync(WILLIAMS_INSTANCE, WILLIAMS_CS, null,
      { volOverlaySet: new Set(['williamsR']), volSeparatePane: true })
    expect(F.callsOf('addSeries')[0].args[2]).toBe(1)
    expect(opts(F).priceScaleId).toBe('left')
    const applied = F.callsOf('priceScale.applyOptions')[0].args[0]
    expect(applied.minimum, 'a shared axis inheriting -100..0 would flip every other series').toBeUndefined()
    expect(applied.autoScale).toBe(true)
  })

  it('a POOLED series is re-fed on a colour AND a period change (#2049)', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, cs: WILLIAMS_CS, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: { williamsR: WILLIAMS_BAND }, volOverlaySet: new Set(),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    })
    run(WILLIAMS_INSTANCE)
    run({ ...WILLIAMS_INSTANCE, inputs: { period: 28, color: '#00ff00' } })
    expect(F.count('addSeries')).toBe(1)
    expect(F.count('removeSeries')).toBe(0)
    const applied = F.callsOf('applyOptions').filter(c => c.on === 'series')
    expect(applied.at(-1).args[0].color).toBe('#00ff00')
    const setDataCalls = F.callsOf('setData')
    const firstFinite = (pts) => pts.findIndex(p => Number.isFinite(p.value))
    expect(firstFinite(setDataCalls[0].args[0])).toBe(13)
    expect(firstFinite(setDataCalls[1].args[0]), 'the period did not reach the compute').toBe(27)
  })
})

// ─── the three together ─────────────────────────────────────────────────────

describe('three adjacent bands, three different scales', () => {
  it('stacks cci, williamsR, mfi bottom-to-top with no gap and no overlap', () => {
    // ⭐ THE ONLY CONFIGURATION IN THE FILE WITH THREE ADJACENT OSCILLATOR BANDS
    // WHOSE SCALES DIFFER (0..100 pinned, autoScale, -100..0 pinned). It is what
    // sees a band mis-stacked by one slot, or a scale range leaking between
    // adjacent price scales.
    const cs = {
      indicators: {
        mfi: { enabled: true }, cci: { enabled: true }, williamsR: { enabled: true },
      },
    }
    const bands = computePaneMargins(cs, false, new Set())
    // `paneMargins.PANES` order is bottom-of-chart → top: cci, williamsR, mfi.
    expect(bands.cci).toEqual({ top: 0.85, bottom: 0 })
    expect(bands.williamsR).toEqual({ top: 0.70, bottom: 0.15 })
    expect(bands.mfi).toEqual({ top: 0.55, bottom: 0.30 })
    // …and they TILE: each band's bottom edge is the one below it's top edge, so
    // there is no gap and no overlap anywhere in the stack.
    // ⚠️ `toBeCloseTo`, not `toBe`: `1 - 0.85` is `0.15000000000000002` in IEEE
    // 754, and a strict compare here would be a test about float representation
    // rather than about the layout. `computePaneMargins` builds every edge from
    // INTEGER hundredths precisely so the stored numbers are exact; it is only
    // the complement taken HERE that is inexact.
    expect(1 - bands.cci.top).toBeCloseTo(bands.williamsR.bottom, 12)
    expect(1 - bands.williamsR.top).toBeCloseTo(bands.mfi.bottom, 12)
    expect(bands.main).toEqual({ top: 0.30, bottom: 0.45 })
  })

  it('binds all three at once, each on its OWN named scale with its OWN range', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const cs = {
      indicators: {
        mfi: { enabled: true }, cci: { enabled: true }, williamsR: { enabled: true },
      },
    }
    const paneMargins = computePaneMargins(cs, false, new Set())
    const result = binder.sync({
      enabled: true, cs, registry: engineRegistry,
      instances: [MFI_INSTANCE, CCI_INSTANCE, WILLIAMS_INSTANCE], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    })
    expect(result.bound).toBe(3)
    // Registry order (mfi, cci, williamsR) regardless of the instance list's.
    expect(binder.bindings().map(b => b.key))
      .toEqual(['legacy:mfi::mfi', 'legacy:cci::cci', 'legacy:williamsR::williams_r'])
    expect(F.callsOf('addSeries').map(c => c.args[1].priceScaleId))
      .toEqual(['mfi', 'cci', 'williamsR'])
    // ⭐ THREE DIFFERENT RANGES ON THREE ADJACENT AXES, ASSERTED TOGETHER. A
    // range leaking from one to the next is the pooled-scale hazard, and it is
    // invisible on any case that turns on one oscillator at a time.
    expect(F.callsOf('priceScale.applyOptions').map(c => c.args[0])).toEqual([
      legacyBandScale(paneMargins.mfi, { autoScale: false, minimum: 0, maximum: 100 }),
      legacyBandScale(paneMargins.cci, { autoScale: true }),
      legacyBandScale(paneMargins.williamsR, { autoScale: false, minimum: -100, maximum: 0 }),
    ])
    // Seven guides in total — 2 + 3 + 2 — each on its own definition's line.
    expect(F.count('createPriceLine')).toBe(7)
    const byId = new Map()
    for (const c of F.callsOf('createPriceLine')) {
      byId.set(c.id, [...(byId.get(c.id) || []), c.args[0].price])
    }
    expect([...byId.values()]).toEqual([[80, 20], [100, -100, 0], [-20, -80]])
  })
})
