import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement, MAIN_PRICE_SCALE_ID } from '../placement'
import { AUTOSCALE_DEFAULT, AUTOSCALE_EXCLUDE, poolKey, seriesOptionsForPlot } from '../pool'
import * as engineRegistry from '../nativeRegistry'
import { ENGINE_OWNED } from '../flipState'
import { computeADX, computeOBV, computeDonchian } from '../../indicators'
import { computePaneLayout, __setPaneModeForTest } from '../paneLayout'
import { createFakeChart, makeBars } from './fakeChart'

// ─── THE FLIP-A CONTRACT FOR ADX, OBV AND DONCHIAN (B5 Task 8) ──────────────
//
// Written and run BEFORE `StockChart.jsx` is touched: every literal below is a
// VERBATIM copy of the shipped block's `addSeries` / `applyIndScale` /
// `createPriceLine` arguments (`StockChart.jsx:6484-6570` at `f45de5ca`), so a
// failure here is a definition-vs-shipped-block disagreement — the migration's
// pixel diff, arriving before the migration and for free.
//
// ⚠️ `toEqual` OVER THE FULL OPTION OBJECT, NEVER `toMatchObject`. A
// `toMatchObject` transcription passes with an extra `lastValueVisible: true`
// that puts an axis tag on the chart the hand-written block never drew.
//
// ⭐ THESE THREE ARE THE LAST THREE, AND THEY ARE THREE DIFFERENT SHAPES:
//
//   · `adx`      THREE lines sharing ONE named scale, `fixedPane(0, 100)`, and
//                the ONLY definition in this task with a guide. Its `max` is
//                100 but its **`min` is ZERO** — falsy — so `resolvePlacement`
//                reaching the pinned branch depends on `Number.isFinite` and not
//                on truthiness, exactly as `williamsR`'s zero `max` did at
//                Task 7. Losing that loses `autoScale: false`, which is the half
//                of the declaration the renderer actually honours (TRAP #2).
//   · `obv`      ONE line, `autoPane` — the ONLY definition in the registry with
//                NO period input at all, and the one whose values run to 1e8, so
//                it is the case that actually exercises the autoscale seam on a
//                REAL scale. B3 Task 1 measured what `exclude` does to an
//                autoscaled band: RSI's column collapsed to -0.5..0.5 and
//                `priceToCoordinate(30)` went 371 → -1640.78.
//                ⚠️ AND IT CARRIES A PRESERVED QUIRK — `computeOBV` seeds bar 0
//                with **0 rather than the NaN pad** (`indicators.js` says so in
//                place). TRANSCRIBED, NOT CORRECTED: correcting it is a measured,
//                owner-facing decision of the shape the MACD head-mask (88 px)
//                and the VWAP session anchor (2,590 px) got.
//   · `donchian` THREE lines on the CANDLES' scale — the LAST price overlay, so
//                `autoscaleInfoProvider` is load-bearing here in the way B3 Task
//                1 priced at 38,491 changed pixels, and LWC's insertion-order
//                z-stacking means it must go in registry order or the shipped
//                stack inverts.
//
// ⛔⭐ AND THE ONE THING A NAIVE TRANSCRIPTION GETS WRONG, MEASURED: DONCHIAN'S
// MIDDLE LINE IS `LargeDashed`, AND THE DEFINITION DECLARED NO STYLE AT ALL.
// The shipped block builds its three with `style: 0, 3, 0` (Solid, LargeDashed,
// Solid). `donchian.middle` carried NO `lineStyle` and a comment saying LWC
// LineStyle 3 was *"unnameable, so unstated"* — true when `PLOT_LINE_STYLES` was
// `solid|dashed|dotted`, and FALSE since `largeDashed` joined it (the same
// extension RSI's 50-midline forced at 379 px). And an omitted plot `lineStyle`
// is NOT "keep what's there" one level down either: `seriesOptionsForPlot`
// resolves it to **`solid`** so a re-purposed series cannot inherit a dash. So
// the engine would have drawn Donchian's mid-line SOLID where the shipped block
// draws it large-dashed — a real pixel difference, invisible to every series
// COUNT and to every scale assertion. The definition names the style now.

// ─── the literal transcription ──────────────────────────────────────────────
// `StockChart.jsx:6484-6570` at `f45de5ca`, verbatim. Do not "tidy" these —
// their whole value is that they are a copy of the shipped call.

/** The tail every one of ADX's three `chart.addSeries(LineSeries, …, adxTgt.pane)`
 *  calls carries — `:6489-6506`. */
const LEGACY_ADX_SHARED = {
  priceScaleId: 'adx',
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}

/** ⭐ `lineWidth: 2` ON THE ADX LINE ALONE. The two directional lines are 1. */
const LEGACY_ADX = { ...LEGACY_ADX_SHARED, color: '#e5e7eb', lineWidth: 2 }
const LEGACY_PLUS_DI = { ...LEGACY_ADX_SHARED, color: '#22c55e', lineWidth: 1 }
const LEGACY_MINUS_DI = { ...LEGACY_ADX_SHARED, color: '#ef4444', lineWidth: 1 }

/** `:6529-6534`. */
const LEGACY_OBV = {
  priceScaleId: 'obv',
  color: '#9ca3af',
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}

/**
 * `:6555-6560`, all three, in shipped creation order.
 *
 * ⛔ NO `priceScaleId` KEY IN THE SHIPPED CALL, and no pane argument either, so
 * LWC defaults both — the candles' scale, pane 0. `placement.js` resolves
 * `price` → `MAIN_PRICE_SCALE_ID` **explicitly**, which is the same answer for a
 * different reason: the explicit form is what stopped a pooled BB band stranding
 * on the `rsi` scale (`pool.seriesOptionsForPlot`'s own note). The ANSWER is
 * asserted; the difference in REASON is recorded here.
 *
 * ⭐ `lineStyle: 3` on the MIDDLE — see the header. Solid, LargeDashed, Solid.
 */
const LEGACY_DONCHIAN_COLOR = 'rgba(96,165,250,0.5)'
const legacyDonchian = (lineStyle) => ({
  priceScaleId: MAIN_PRICE_SCALE_ID,
  color: LEGACY_DONCHIAN_COLOR,
  lineWidth: 1,
  lineStyle,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
  autoscaleInfoProvider: AUTOSCALE_EXCLUDE,
})
const LEGACY_DONCHIAN = [legacyDonchian(0), legacyDonchian(3), legacyDonchian(0)]

/**
 * The options the engine states that the legacy blocks do NOT — each equal to
 * the value a freshly-created LWC 5.2.0 line series already has, so a CREATED
 * series is byte-identical and a RE-PURPOSED one is reset to it.
 *
 * The complete-key-set rule (`pool.seriesOptionsForPlot`) is why they exist:
 * `applyOptions` MERGES and `merge()` SKIPS `undefined`, so an option a plot
 * does not name survives from the previous tenant.
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

/** …and the PRICE-OVERLAY half of the same list. `lineStyle` is NOT in here —
 *  Donchian names all three of its own — and `autoscaleInfoProvider` is the
 *  EXCLUDE singleton, which the shipped block states as `() => null`. */
const LWC_LINE_DEFAULTS_RESTATED_PRICE = {
  visible: true,
  lineType: 0,
  pointMarkersVisible: false,
  pointMarkersRadius: 3,
  priceFormat: { type: 'price', precision: 2 },
}

/** `applyIndScale(key, series, tgt, bandExtra)`'s non-`left` branch, `:6009`. */
const legacyBandScale = (band, extra) => ({
  borderVisible: false,
  scaleMargins: band,
  ...extra,
})

/** `applyIndScale`'s `left` branch, `:6007` — verbatim, every key. */
const LEGACY_LEFT_AXIS = {
  borderVisible: false,
  visible: true,
  autoScale: true,
  scaleMargins: { top: 0.12, bottom: 0.04 },
}

/** ⛔ NO `title`: the shipped calls state none. Every other key IS stated,
 *  because an omitted one takes LWC's default rather than "keep what's there" —
 *  and LWC's `createPriceLine` default for `lineStyle` is Dashed. */
const guide = (price, color, lineStyle) => (
  { price, color, lineWidth: 1, lineStyle, axisLabelVisible: false })

/** `adxSeriesRef.current.createPriceLine(<this>)` — `:6508`. ONE guide. */
const LEGACY_ADX_GUIDES = [guide(25, 'rgba(229,231,235,0.3)', 2)]

// ─── the fixtures ───────────────────────────────────────────────────────────

const BARS = makeBars(260)

const ADX_INSTANCE = {
  instanceId: 'legacy:adx', defId: 'adx', defVersion: 1,
  inputs: { period: 14, adxColor: '#e5e7eb', plusDIColor: '#22c55e', minusDIColor: '#ef4444' },
  placement: { target: 'pane' }, hidden: false,
}

const OBV_INSTANCE = {
  instanceId: 'legacy:obv', defId: 'obv', defVersion: 1,
  inputs: { color: '#9ca3af' },
  placement: { target: 'pane' }, hidden: false,
}

const DONCHIAN_INSTANCE = {
  instanceId: 'legacy:donchian', defId: 'donchian', defVersion: 1,
  inputs: { period: 20, color: LEGACY_DONCHIAN_COLOR },
  placement: { target: 'price' }, hidden: false,
}

/** The `cs` each parity case pins. */
const ADX_CS = { indicators: { adx: { enabled: true, period: 14, adxColor: '#e5e7eb', plusDIColor: '#22c55e', minusDIColor: '#ef4444' } } }
const OBV_CS = { indicators: { obv: { enabled: true, color: '#9ca3af' } } }
const DONCHIAN_CS = { indicators: { donchian: { enabled: true, period: 20, color: LEGACY_DONCHIAN_COLOR } } }

/**
 * The band map, from the ONE surviving authority.
 *
 * ⭐ B5 TASK 12 RETIRED `chart/paneMargins.js` INTO `engine/paneLayout.js`.
 * `computePaneLayout(...).bands` IS `computePaneMargins`' output — same keys,
 * same values, same insertion order, off the same quantised stack — but it is
 * keyed on the INSTANCE LIST rather than on a settings blob, because the
 * instance list is the only authority for the stack now. It is also
 * height-independent by construction, which is why no `chartHeight` is passed.
 *
 * ⚠️ `defIds` IS TOP-TO-BOTTOM, i.e. pane order — the same order the instance
 * list carries, and the REVERSE of the order the retired `PANES` table listed.
 * A PRICE OVERLAY named here reserves nothing: `computePaneLayout` keeps only
 * `placement.target === 'pane'` definitions, which is why `donchian` can be
 * passed alongside adx and obv and still leave both bands where they are.
 */
const bandsFor = (defIds, hasVolumeBand = false, excludeKeys = new Set()) =>
  computePaneLayout(
    defIds.map((id) => ({ instanceId: `legacy:${id}`, defId: id })),
    { hasVolumeBand, excludeKeys },
  ).bands

const ADX_BAND = bandsFor(['adx']).adx
const OBV_BAND = bandsFor(['obv']).obv

// ⭐ B5 TASK 12 — THIS FILE DESCRIBES THE GEOMETRY THE FLIP REVERSES TO.
// `PANE_MODE` is `'panes'` since Task 12, so an UNPINNED resolve would send adx
// and obv into real lightweight-charts panes on a `'right'` scale with zero
// margins. Every expectation in this file is a transcription of the BANDS
// answer — the mode `paneLayout.js` keeps alive precisely so the flip has
// something to reverse to — so the MODE is pinned rather than the expectations
// rewritten. (Donchian is a PRICE overlay and resolves the same either way;
// pinning is what keeps the two halves of this file readable together.)
beforeEach(() => { __setPaneModeForTest('bands') })
afterEach(() => { __setPaneModeForTest(null) })

const sync = (instances, cs, paneMargins, over) => {
  const F = createFakeChart()
  const binder = createBinder({ chart: F.chart, LWC: F.LWC })
  const result = binder.sync({
    enabled: true, cs, registry: engineRegistry,
    instances: Array.isArray(instances) ? instances : [instances],
    bars: BARS, adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
    paneMargins: paneMargins || {}, volOverlaySet: new Set(),
    volSeparatePane: true, VOL_PANE_INDEX: 1,
    ...over,
  })
  return { F, binder, result }
}

const opts = (F, i = 0) => F.callsOf('addSeries')[i].args[1]
const plotFor = (defId, key) =>
  engineRegistry.getDefinition(defId).plots.find(p => p.key === key)
const asLegacyPoints = (pts) => pts.map(p => (
  Number.isFinite(p.value) ? { time: p.time, value: p.value } : { time: p.time }))
const firstFinite = (pts) => pts.findIndex(p => Number.isFinite(p.value))

/**
 * The `hlines` guide specs one definition would create, in the order the binder
 * creates them.
 *
 * ⛔ THROWS BY NAME on a definition that has no guides, rather than returning
 * `[]` — a helper that loops over nothing turns every guide assertion below into
 * `expect([]).toEqual([])`. (Task 7 measured that its own M9 was lethal for the
 * WRONG reason precisely because the expectation it landed on was non-empty; the
 * throw needs its own case, below.)
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

// ─── adx ────────────────────────────────────────────────────────────────────

describe('adx — three lines, one scale, one guide', () => {
  it('⛔ guidesFor THROWS BY NAME on a miss — it never loops over nothing', () => {
    expect(() => guidesFor('adxX')).toThrow(/no definition named adxX/)
    // `obv` is a REAL definition that declares no `hlines` plot — the other miss.
    expect(() => guidesFor('obv')).toThrow(/created ZERO price lines/)
    // …and the control that the helper WORKS, so the two throws above are not
    // simply "this helper always throws".
    expect(guidesFor('adx')).toHaveLength(1)
  })

  it('all three lines share the adx price scale and only ADX is width 2', () => {
    const ctx = { scaleId: 'adx', autoscale: 'default' }
    expect(['adx', 'plusDI', 'minusDI'].map(k =>
      seriesOptionsForPlot(plotFor('adx', k), ctx).lineWidth)).toEqual([2, 1, 1])
    expect(['adx', 'plusDI', 'minusDI'].map(k =>
      seriesOptionsForPlot(plotFor('adx', k), ctx).priceScaleId)).toEqual(['adx', 'adx', 'adx'])
    // …and every one of the three is a plain `line`, so a re-purpose between them
    // is legal and the complete key set is what keeps `lineWidth: 2` from leaking.
    expect(['adx', 'plusDI', 'minusDI'].map(k => poolKey(plotFor('adx', k))))
      .toEqual(['line', 'line', 'line'])
  })

  it('one guide at 25, and the scale is pinned 0..100', () => {
    expect(guidesFor('adx')).toEqual(LEGACY_ADX_GUIDES)
    const ctx = {
      paneMargins: bandsFor(['adx'], true),
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'adx' }, engineRegistry.getDefinition('adx'), ctx).scaleOptions)
      .toEqual({
        borderVisible: false, scaleMargins: ctx.paneMargins.adx,
        autoScale: false, minimum: 0, maximum: 100,
      })
  })

  it('⭐ THE PINNED SCALE NEEDS `Number.isFinite`, NOT TRUTHINESS — min is 0', () => {
    // ⚠️ THE SAME TRAP williamsR SPRUNG FROM THE OTHER END AT TASK 7.
    // `resolvePlacement` picks the pinned branch on `Number.isFinite(scale.min)
    // && Number.isFinite(scale.max)`. `adx` declares `fixedPane(0, 100)`, so its
    // `min` is ZERO and therefore FALSY: a `scale.min && scale.max` guard sends
    // it down the `{autoScale: true}` branch and loses the `autoScale: false`
    // that freezes a pooled scale against re-invalidation (TRAP #2).
    const adx = engineRegistry.getDefinition('adx').placement.scale
    expect(adx).toEqual({ min: 0, max: 100 })
    expect(Boolean(adx.min), 'adx.min is FALSY — this is the trap').toBe(false)
    expect(Number.isFinite(adx.min)).toBe(true)
    // …and it reaches the RENDERER, not just the resolver.
    const { F } = sync(ADX_INSTANCE, ADX_CS, { adx: ADX_BAND })
    expect(F.callsOf('priceScale.applyOptions')[0].args[0])
      .toEqual(legacyBandScale(ADX_BAND, { autoScale: false, minimum: 0, maximum: 100 }))
  })

  it('creates THREE LineSeries in pane 0 with the shipped option objects, key for key', () => {
    const { F, result } = sync(ADX_INSTANCE, ADX_CS, { adx: ADX_BAND })
    expect(result.ok).toBe(true)
    expect(result.bound).toBe(3)
    const created = F.callsOf('addSeries')
    expect(created).toHaveLength(3)
    for (const c of created) {
      expect(c.args[0]).toBe(F.LWC.LineSeries)
      // Flip A draws into a BAND inside pane 0, not a real pane. A `1` here is
      // the B5 geometry arriving early, and it would move every other series.
      expect(c.args[2]).toBe(0)
    }
    expect(created.map(c => c.args[1])).toEqual([
      { ...LEGACY_ADX, ...LWC_LINE_DEFAULTS_RESTATED },
      { ...LEGACY_PLUS_DI, ...LWC_LINE_DEFAULTS_RESTATED },
      { ...LEGACY_MINUS_DI, ...LWC_LINE_DEFAULTS_RESTATED },
    ])
    expect(opts(F, 0)).toMatchObject(LEGACY_ADX)
  })

  it('asserts the FULL price-scale set on the adx scale — three times, identically', () => {
    // ⛔🔴 THE SHIPPED BLOCK CALLS `applyIndScale` ONCE (on the ADX line alone)
    // AND SO DOES THE BINDER — SINCE THIS TASK, AND IT COST 11,913 CHANGED
    // PIXELS TO LEARN. This comment used to end *"that is a difference in CALL
    // COUNT and not in the picture… the second and third calls set it to what it
    // already holds"*, and the PAYLOAD half of that was true. The ORDER half was
    // not: `autoScale: false` does not compute anything, it stops the range ever
    // being recomputed, and the range is materialised the first time anything
    // asks — which a `priceScale().applyOptions` does. The second call landed
    // between `setData(adx)` and `setData(plusDI)`, so the engine's adx scale
    // froze at 15.5154..59.0249 (the ADX line's OWN extent) where the shipped
    // build holds 5.1746..59.0249 (all three lines). Measured on the two-build
    // gate with the scale range read out of the live chart.
    // ⭐ `stoch` could not have caught it: `%D` is a moving average OF `%K`, so
    // `%K`'s extent already contains it.
    const { F } = sync(ADX_INSTANCE, ADX_CS, { adx: ADX_BAND })
    const scaleCalls = F.callsOf('priceScale.applyOptions')
    expect(scaleCalls, 'the adx scale was written more than once in one sync — '
      + 'the repeat is what froze its range on the ADX line alone').toHaveLength(1)
    for (const call of scaleCalls) {
      expect(call.args[0]).toEqual(
        legacyBandScale(ADX_BAND, { autoScale: false, minimum: 0, maximum: 100 }))
    }
    // …and they really are one scale, which is what makes the repeat inert.
    expect(new Set(F.callsOf('addSeries').map(c => c.args[1].priceScaleId)).size).toBe(1)
  })

  it('⛔⭐ EVERY SERIES EXISTS BEFORE ANY OF THEM HAS DATA — the 11,913-px ordering', () => {
    // 🔴 THE ONE REAL PIXEL REGRESSION IN THIS TASK, AND NO OTHER ASSERTION IN
    // THIS FILE COULD SEE IT. Every option object, every scale payload, every
    // guide, the whole pane manifest AND THE SERIES DATA THEMSELVES were
    // identical between the shipped block and the engine — read off the live
    // charts, both sides: adx n=173 min 15.5154 max 59.0249, plusDI n=186 min
    // 5.1746, minusDI n=186 min 6.2697. What differed was the frozen RANGE:
    // legacy 5.1746..59.0249, engine 15.5154..59.0249 — the ADX line alone.
    //
    // `autoScale: false` computes nothing; it stops the range from ever being
    // recomputed (`_internal_recalculatePriceScale` returns early for a non-auto
    // scale). The range is then materialised the first time something asks, from
    // the sources that HAVE DATA at that moment. The shipped block creates all
    // three series, calls `applyIndScale` ONCE, and only then feeds data, so
    // nothing is materialisable until every line is in. The binder interleaved
    // create → scale → data per binding, so the scale was asked twice more, each
    // time between two siblings' `setData` calls.
    //
    // ⚠️ BOTH HALVES ARE REQUIRED AND EACH WAS MEASURED INSUFFICIENT ALONE:
    //   • create-all-first, scale still per binding  → 11,913 px
    //   • scale once, creates still interleaved      → 11,913 px
    //   • both (the shipped shape)                   →      0 px
    const { F } = sync(ADX_INSTANCE, ADX_CS, { adx: ADX_BAND })
    const methods = F.calls.map(c => c.method)
    const lastAdd = methods.lastIndexOf('addSeries')
    const firstScale = methods.indexOf('priceScale.applyOptions')
    const firstGuide = methods.indexOf('createPriceLine')
    const firstData = methods.indexOf('setData')
    // Non-vacuity FIRST — an empty log satisfies every ordering claim below.
    expect(F.count('addSeries'), 'nothing was created — the ordering is vacuous').toBe(3)
    expect(F.count('setData')).toBe(3)
    expect(firstGuide, 'no guide was created').toBeGreaterThan(-1)
    // …and the claim, in the shipped block's own order.
    expect(firstScale,
      'the adx price scale was written before all three of its series existed')
      .toBeGreaterThan(lastAdd)
    expect(F.count('priceScale.applyOptions'),
      'the scale was written more than once in one sync — the repeat is what froze '
      + 'the range on whichever sibling already had data').toBe(1)
    expect(firstGuide).toBeGreaterThan(firstScale)
    expect(firstData).toBeGreaterThan(firstGuide)
  })

  it('the guide lands on the ADX line itself — not on +DI, not on -DI', () => {
    const { F } = sync(ADX_INSTANCE, ADX_CS, { adx: ADX_BAND })
    const lines = F.callsOf('createPriceLine')
    expect(lines).toHaveLength(1)
    expect(lines.map(c => c.args[0])).toEqual(LEGACY_ADX_GUIDES)
    // The FIRST data-bearing plot of the instance, which is the ADX line — the
    // shipped block puts it there too. On +DI it would still draw at 25 and look
    // identical until the two series are hidden independently.
    expect(lines[0].id).toBe(F.seriesCreated[0].__id)
    // ⛔ NO `title` — the shipped call states none, and LWC draws a label for one.
    expect('title' in lines[0].args[0], 'the guide gained a title').toBe(false)
  })

  it('sets exactly the data the legacy block would have set, on all three lines', () => {
    const { F } = sync(ADX_INSTANCE, ADX_CS, { adx: ADX_BAND })
    const raw = computeADX(BARS, 14)
    const written = F.callsOf('setData').map(c => c.args[0])
    expect(written).toHaveLength(3)
    expect(written[0]).toEqual(asLegacyPoints(raw.adx))
    expect(written[1]).toEqual(asLegacyPoints(raw.plusDI))
    expect(written[2]).toEqual(asLegacyPoints(raw.minusDI))
    // Non-vacuous at both ends: real numbers at the tail, whitespace at the head,
    // and ADX's own head is LONGER than the two directional lines' — a swap of
    // the three columns would be invisible without this.
    for (const w of written) expect(w).toHaveLength(BARS.length)
    expect(written[0][0].value).toBeUndefined()
    expect(written[0].at(-1).value).toBeGreaterThan(0)
    expect(firstFinite(written[0])).toBeGreaterThan(firstFinite(written[1]))
    expect(firstFinite(written[1])).toBe(firstFinite(written[2]))
  })

  it('makes NO other renderer call', () => {
    const { F } = sync(ADX_INSTANCE, ADX_CS, { adx: ADX_BAND })
    expect(F.methodsUsed().sort()).toEqual(
      ['addSeries', 'createPriceLine', 'priceScale.applyOptions', 'setData'])
  })

  it('and the volume-overlay path puts all three on pane 1 / left, DROPPING 0..100', () => {
    const ctx = {
      paneMargins: {}, volOverlaySet: new Set(['adx']),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'adx' }, engineRegistry.getDefinition('adx'), ctx)).toEqual({
      paneIndex: 1, scaleId: 'left', autoscale: 'default',
      scaleOptions: { ...LEGACY_LEFT_AXIS, scaleMargins: { ...LEGACY_LEFT_AXIS.scaleMargins } },
    })
    const { F } = sync(ADX_INSTANCE, ADX_CS, null,
      { volOverlaySet: new Set(['adx']), volSeparatePane: true })
    expect(F.callsOf('addSeries').map(c => c.args[2])).toEqual([1, 1, 1])
    expect(F.callsOf('addSeries').map(c => c.args[1].priceScaleId)).toEqual(['left', 'left', 'left'])
    const applied = F.callsOf('priceScale.applyOptions')[0].args[0]
    expect(applied.minimum, 'the shared left axis must not inherit adx\'s 0-100').toBeUndefined()
    expect(applied.autoScale).toBe(true)
  })

  it('a POOLED trio is re-fed on a colour AND a period change, never recreated (#2049)', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, cs: ADX_CS, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: { adx: ADX_BAND }, volOverlaySet: new Set(),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    })
    run(ADX_INSTANCE)
    run({ ...ADX_INSTANCE, inputs: { ...ADX_INSTANCE.inputs, adxColor: '#ff0000' } })
    run({ ...ADX_INSTANCE, inputs: { ...ADX_INSTANCE.inputs, adxColor: '#ff0000', period: 21 } })
    expect(F.count('addSeries'), 'a restyle or a period change must not create a second series').toBe(3)
    expect(F.count('removeSeries'), 'a restyle must not destroy the series').toBe(0)
    // ⚠️ THE GUIDE IS NOT CHURNED — 25 is a literal, not an input — so the guide
    // signature does not move and LWC (which has no "update a price line") is
    // asked for nothing.
    expect(F.count('createPriceLine'), 'the guide was recreated on a restyle').toBe(1)
    expect(F.count('removePriceLine')).toBe(0)
    const applied = F.callsOf('applyOptions').filter(c => c.on === 'series')
    expect(applied.some(c => c.args[0].color === '#ff0000')).toBe(true)
    // The re-assert is the COMPLETE option set, not a delta.
    expect(Object.keys(applied[0].args[0]).sort()).toEqual(Object.keys(opts(F, 0)).sort())
    // …and the NUMBERS moved with the period, which is what tells a live compute
    // from a replay. A colour-only check cannot: a period appears in NO option.
    // ⚠️ MEASURED AT THE NaN HEAD, not at `.at(-1)`: Task 5 found the obvious
    // tail probe VACUOUS for ATR on this fixture (ATR(14) === ATR(21) at the last
    // bar to the last bit), and ADX's head is period-dependent by construction.
    const written = F.callsOf('setData').map(c => c.args[0])
    expect(written).toHaveLength(9)
    expect(firstFinite(written[0])).toBe(27)
    expect(firstFinite(written[6]), 'the period did not reach the compute').toBe(41)
    expect(written[6]).not.toEqual(written[3])
  })
})

// ─── obv ────────────────────────────────────────────────────────────────────

describe('obv — the autoscale seam, on values that are actually large', () => {
  it('autoScale true, and the provider is DEFAULT not EXCLUDE', () => {
    // ⭐ B3 Task 1 measured what `exclude` does to an autoscaled band: RSI's
    // column collapsed to -0.5..0.5 and priceToCoordinate(30) went from 371 to
    // -1640.78. obv's values are 1e8-scale, so an inverted provider here is the
    // most visible mistake available in this task.
    const ctx = {
      paneMargins: bandsFor(['obv'], true),
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    }
    const p = resolvePlacement({ defId: 'obv' }, engineRegistry.getDefinition('obv'), ctx)
    expect(p.autoscale).toBe('default')
    expect(p.scaleOptions).toEqual({
      borderVisible: false, scaleMargins: ctx.paneMargins.obv, autoScale: true,
    })
    expect(p.scaleOptions.minimum, 'obv must not inherit a fixed range').toBeUndefined()
    expect(engineRegistry.getDefinition('obv').placement.scale).toBeUndefined()
    // …and the provider the renderer actually receives is the IDENTITY one.
    expect(seriesOptionsForPlot(plotFor('obv', 'obv'), { scaleId: 'obv', autoscale: p.autoscale })
      .autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)
  })

  it('⭐ and the values really are 1e8-scale, so the seam is not theoretical', () => {
    const pts = computeOBV(BARS)
    expect(Math.max(...pts.map(p => Math.abs(p.value)))).toBeGreaterThan(1e7)
  })

  it('creates ONE LineSeries in pane 0 with the shipped option object, key for key', () => {
    const { F, result } = sync(OBV_INSTANCE, OBV_CS, { obv: OBV_BAND })
    expect(result.ok).toBe(true)
    expect(result.bound).toBe(1)
    const created = F.callsOf('addSeries')
    expect(created).toHaveLength(1)
    expect(created[0].args[0]).toBe(F.LWC.LineSeries)
    expect(created[0].args[2]).toBe(0)
    expect(opts(F)).toMatchObject(LEGACY_OBV)
    expect(opts(F)).toEqual({ ...LEGACY_OBV, ...LWC_LINE_DEFAULTS_RESTATED })
  })

  it('one autoScale:true scale call, with NO inherited fixed range', () => {
    const { F } = sync(OBV_INSTANCE, OBV_CS, { obv: OBV_BAND })
    const scaleCalls = F.callsOf('priceScale.applyOptions')
    expect(scaleCalls).toHaveLength(1)
    expect(scaleCalls[0].args[0]).toEqual(legacyBandScale(OBV_BAND, { autoScale: true }))
    expect(scaleCalls[0].args[0].minimum).toBeUndefined()
    expect(scaleCalls[0].args[0].maximum).toBeUndefined()
  })

  it('⭐ TRANSCRIBES OBV\'S ZERO SEED — bar 0 is 0, not whitespace', () => {
    // ⚠️ A PRESERVED QUIRK, DELIBERATELY NOT CORRECTED. `computeOBV` seeds bar 0
    // with `{value: 0}` where every other native NaN-pads its head, and
    // `indicators.js` says so in place. It survives the column round-trip
    // (`toColumn` keeps a finite 0; `Number.isFinite(0)` is true — the same falsy
    // number that CCI's zero guide turned on at Task 7), so OBV is the ONE
    // definition here with no whitespace head at all. Correcting it is a
    // measured, owner-facing decision of the shape the MACD head-mask (88 px) and
    // the VWAP anchor (2,590 px) got — not a thing a migration does on the way
    // past.
    const { F } = sync(OBV_INSTANCE, OBV_CS, { obv: OBV_BAND })
    const points = F.callsOf('setData')[0].args[0]
    expect(points).toEqual(asLegacyPoints(computeOBV(BARS)))
    expect(points).toHaveLength(BARS.length)
    expect(points[0], 'the zero seed became whitespace').toEqual({ time: BARS[0].t, value: 0 })
    expect(firstFinite(points), 'OBV has no NaN head at all').toBe(0)
    // The control that this is a QUIRK and not the norm: every other definition
    // in this task starts with whitespace.
    const { F: F2 } = sync(ADX_INSTANCE, ADX_CS, { adx: ADX_BAND })
    expect(F2.callsOf('setData')[0].args[0][0].value).toBeUndefined()
  })

  it('makes NO other renderer call — it has no guides', () => {
    const { F } = sync(OBV_INSTANCE, OBV_CS, { obv: OBV_BAND })
    expect(F.methodsUsed().sort()).toEqual(
      ['addSeries', 'priceScale.applyOptions', 'setData'])
    expect(F.count('createPriceLine')).toBe(0)
  })

  it('⭐ declares NO period input at all — the only definition in the registry that does not', () => {
    // ⚠️ WHY THE PIXEL GATE'S PERIOD RULE IS EXEMPTED FOR THIS ONE. Every other
    // fail-proof on this branch perturbs a PERIOD, because a period appears in no
    // option object and therefore distinguishes a live compute from a replay.
    // `obv` has no period to perturb — `computeOBV(bars)` takes the bars alone —
    // so its fail-proof is a COLOUR, and that exemption is written down here
    // rather than left as the shape of a vacuous self-test.
    expect(engineRegistry.getDefinition('obv').inputs.map(i => i.key)).toEqual(['color'])
    const withPeriods = engineRegistry.listDefinitions()
      .filter(d => d.inputs.some(i => i.type === 'int' && /period/i.test(i.key))).map(d => d.id)
    expect(withPeriods, 'obv gained a period — its fail-proof can be a period now')
      .not.toContain('obv')
    expect(withPeriods.length, 'no definition declares a period — the exemption is meaningless')
      .toBeGreaterThan(8)
  })

  it('and the volume-overlay path puts it on pane 1 / left', () => {
    const ctx = {
      paneMargins: {}, volOverlaySet: new Set(['obv']),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    }
    expect(resolvePlacement({ defId: 'obv' }, engineRegistry.getDefinition('obv'), ctx)).toEqual({
      paneIndex: 1, scaleId: 'left', autoscale: 'default',
      scaleOptions: { ...LEGACY_LEFT_AXIS, scaleMargins: { ...LEGACY_LEFT_AXIS.scaleMargins } },
    })
    const { F } = sync(OBV_INSTANCE, OBV_CS, null,
      { volOverlaySet: new Set(['obv']), volSeparatePane: true })
    expect(F.callsOf('addSeries')[0].args[2]).toBe(1)
    expect(opts(F).priceScaleId).toBe('left')
  })

  it('a POOLED series is re-fed on a COLOUR change, never recreated (#2049)', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, cs: OBV_CS, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: { obv: OBV_BAND }, volOverlaySet: new Set(),
      volSeparatePane: true, VOL_PANE_INDEX: 1,
    })
    run(OBV_INSTANCE)
    run({ ...OBV_INSTANCE, inputs: { color: '#00ff00' } })
    expect(F.count('addSeries')).toBe(1)
    expect(F.count('removeSeries')).toBe(0)
    const applied = F.callsOf('applyOptions').filter(c => c.on === 'series')
    expect(applied.at(-1).args[0].color).toBe('#00ff00')
    expect(Object.keys(applied[0].args[0]).sort()).toEqual(Object.keys(opts(F, 0)).sort())
    // The DATA is unchanged across a colour change, which is the honest half of
    // the exemption above: with no period there is nothing an input can move.
    const written = F.callsOf('setData').map(c => c.args[0])
    expect(written).toHaveLength(2)
    expect(written[1]).toEqual(written[0])
  })
})

// ─── donchian ───────────────────────────────────────────────────────────────

describe('donchian — a band plot with edges, and the LAST price overlay', () => {
  it('upper and lower are solid lines; the middle is the band, and it names its edges', () => {
    const d = engineRegistry.getDefinition('donchian')
    expect(d.plots.map(p => [p.key, p.style])).toEqual(
      [['upper', 'line'], ['middle', 'band'], ['lower', 'line']])
    expect(d.plots.find(p => p.key === 'middle').edges).toEqual({ upper: 'upper', lower: 'lower' })
    // A `band` is a LineSeries here — no fill — so all three share a pool bucket.
    expect(d.plots.map(p => poolKey(p))).toEqual(['line', 'line', 'line'])
  })

  it('⛔⭐ THE MIDDLE IS LargeDashed, AND THE DEFINITION HAS TO SAY SO', () => {
    // The shipped block builds its three with `style: 0, 3, 0`. `middle` declared
    // NO `lineStyle`, behind a comment saying LineStyle 3 was "unnameable, so
    // unstated" — true when `PLOT_LINE_STYLES` was solid|dashed|dotted, false
    // since `largeDashed` joined it. And an omitted plot style is not "keep what
    // is there" one level down either: `seriesOptionsForPlot` resolves it to
    // SOLID, so the engine would have drawn the mid-line solid. No series count,
    // no scale assertion and no `edges` check can see that.
    const d = engineRegistry.getDefinition('donchian')
    expect(d.plots.map(p => p.lineStyle)).toEqual(['solid', 'largeDashed', 'solid'])
    expect(d.plots.map(p => seriesOptionsForPlot(p, { scaleId: MAIN_PRICE_SCALE_ID, autoscale: 'exclude' }).lineStyle))
      .toEqual([0, 3, 0])
    // …stated a second way, by CONTRAST with BB, which is the same band shape
    // with the opposite styling: dashed edges around a SOLID middle.
    expect(engineRegistry.getDefinition('bb').plots.map(p => p.lineStyle))
      .toEqual(['dashed', 'solid', 'dashed'])
  })

  it('it carries NO priceScaleId of its own — the shipped block omitted it and got the candles scale', () => {
    // ⚠️ The shipped block passes no priceScaleId at all, so LWC defaults it to
    // 'right'. `placement.js` resolves `price` -> MAIN_PRICE_SCALE_ID = 'right'
    // EXPLICITLY, which is the same answer for a different reason — and the
    // explicit form is the one that stopped a pooled BB band stranding on the
    // rsi scale. Assert the ANSWER, and record the difference in reason.
    expect(MAIN_PRICE_SCALE_ID).toBe('right')
    const ctx = { paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1 }
    expect(resolvePlacement(DONCHIAN_INSTANCE, engineRegistry.getDefinition('donchian'), ctx))
      .toEqual({ paneIndex: 0, scaleId: 'right', scaleOptions: null, autoscale: 'exclude' })
  })

  it('⭐ and it is autoscale-EXCLUDED — B3 Task 1 priced the other answer at 38,491 px', () => {
    // A price overlay is a GUEST on the candles' axis. The shipped block states
    // `autoscaleInfoProvider: () => null` on all three; `AUTOSCALE_EXCLUDE` is
    // that, as a module-level singleton so two identical resolves stay equal.
    const ctx = { paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1 }
    expect(resolvePlacement(DONCHIAN_INSTANCE, engineRegistry.getDefinition('donchian'), ctx).autoscale)
      .toBe('exclude')
    const { F } = sync(DONCHIAN_INSTANCE, DONCHIAN_CS, {})
    for (const c of F.callsOf('addSeries')) {
      expect(c.args[1].autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
    }
    // …and Donchian's channel is exactly the shape that stretches a range: its
    // upper is the highest high of the window and its lower the lowest low, so
    // the two are always AT or OUTSIDE the candles' own extent.
    const raw = computeDonchian(BARS, 20)
    const hi = Math.max(...BARS.map(b => b.h))
    const lo = Math.min(...BARS.map(b => b.l))
    expect(Math.max(...raw.upper.map(p => p.value).filter(Number.isFinite))).toBe(hi)
    expect(Math.min(...raw.lower.map(p => p.value).filter(Number.isFinite))).toBe(lo)
  })

  it('creates THREE LineSeries in pane 0 with the shipped option objects, key for key', () => {
    const { F, result } = sync(DONCHIAN_INSTANCE, DONCHIAN_CS, {})
    expect(result.ok).toBe(true)
    expect(result.bound).toBe(3)
    const created = F.callsOf('addSeries')
    expect(created).toHaveLength(3)
    for (const c of created) {
      expect(c.args[0]).toBe(F.LWC.LineSeries)
      expect(c.args[2], 'a price overlay lives in pane 0').toBe(0)
    }
    expect(created.map(c => c.args[1])).toEqual(
      LEGACY_DONCHIAN.map(o => ({ ...o, ...LWC_LINE_DEFAULTS_RESTATED_PRICE })))
  })

  it('asserts NOTHING on the candles\' price scale — that would move the candles', () => {
    const { F } = sync(DONCHIAN_INSTANCE, DONCHIAN_CS, {})
    expect(F.callsOf('priceScale.applyOptions')).toHaveLength(0)
    expect(F.methodsUsed().sort()).toEqual(['addSeries', 'setData'])
  })

  it('sets exactly the data the legacy block would have set, upper/middle/lower', () => {
    const { F } = sync(DONCHIAN_INSTANCE, DONCHIAN_CS, {})
    const raw = computeDonchian(BARS, 20)
    const written = F.callsOf('setData').map(c => c.args[0])
    expect(written).toHaveLength(3)
    expect(written[0]).toEqual(asLegacyPoints(raw.upper))
    expect(written[1]).toEqual(asLegacyPoints(raw.middle))
    expect(written[2]).toEqual(asLegacyPoints(raw.lower))
    for (const w of written) {
      expect(w).toHaveLength(BARS.length)
      expect(w[0].value).toBeUndefined()
      expect(firstFinite(w)).toBe(19)
    }
    // …and the three are genuinely DIFFERENT columns, so a mis-wired `edges` that
    // fed the same column three times would be visible here.
    expect(written[0].at(-1).value).toBeGreaterThan(written[1].at(-1).value)
    expect(written[1].at(-1).value).toBeGreaterThan(written[2].at(-1).value)
  })

  it('and it is inserted LAST among the price overlays, as it is today', () => {
    // ⭐ LWC Z-STACKS BY INSERTION, and the engine draws everything it owns
    // contiguously at ONE call site. `bb, vwap, sar, ichimoku, donchian` is the
    // registry order AND the shipped legacy render order, so migrating donchian
    // last is what keeps it on top of the four it sits on top of today.
    expect(engineRegistry.listDefinitions()
      .filter(d => d.placement && d.placement.target === 'price').map(d => d.id))
      .toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
    // …and the binder really does insert in the order it is handed, which is why
    // the instance list's order is the thing that has to be registry order.
    const overlays = ['bb', 'vwap', 'sar', 'ichimoku', 'donchian'].map(id => ({
      instanceId: `legacy:${id}`, defId: id, defVersion: 1, inputs: {},
      placement: { target: 'price' }, hidden: false,
    }))
    const { binder } = sync(overlays, {}, {})
    expect(binder.bindings().map(b => b.instanceId)).toEqual([
      'legacy:bb', 'legacy:bb', 'legacy:bb',
      'legacy:vwap',
      'legacy:sar',
      'legacy:ichimoku', 'legacy:ichimoku', 'legacy:ichimoku', 'legacy:ichimoku', 'legacy:ichimoku',
      'legacy:donchian', 'legacy:donchian', 'legacy:donchian',
    ])
    // ⛔ AND THE CONTROL THAT MAKES THAT ASSERTION MEAN SOMETHING: the binder
    // follows the LIST, not the registry, so a list in another order re-stacks
    // the overlays. That is why `migrateLegacyToInstances` walks the registry.
    const { binder: reversed } = sync([...overlays].reverse(), {}, {})
    expect(reversed.bindings()[0].instanceId).toBe('legacy:donchian')
  })

  it('a POOLED trio is re-fed on a colour AND a period change, never recreated (#2049)', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, cs: DONCHIAN_CS, registry: engineRegistry, instances: [inst], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    })
    run(DONCHIAN_INSTANCE)
    run({ ...DONCHIAN_INSTANCE, inputs: { period: 20, color: '#ff00ff' } })
    run({ ...DONCHIAN_INSTANCE, inputs: { period: 55, color: '#ff00ff' } })
    expect(F.count('addSeries')).toBe(3)
    expect(F.count('removeSeries')).toBe(0)
    const applied = F.callsOf('applyOptions').filter(c => c.on === 'series')
    expect(applied.some(c => c.args[0].color === '#ff00ff')).toBe(true)
    expect(Object.keys(applied[0].args[0]).sort()).toEqual(Object.keys(opts(F, 0)).sort())
    const written = F.callsOf('setData').map(c => c.args[0])
    expect(written).toHaveLength(9)
    expect(firstFinite(written[0])).toBe(19)
    expect(firstFinite(written[6]), 'the period did not reach the compute').toBe(54)
  })
})

// ─── the three together, and the lane ───────────────────────────────────────

describe('the last three together', () => {
  it('two adjacent bands and a price overlay, each on its own scale', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const cs = {
      indicators: {
        adx: { enabled: true }, obv: { enabled: true }, donchian: { enabled: true },
      },
    }
    // TOP-TO-BOTTOM: adx sits ABOVE obv. `donchian` is named too and reserves
    // nothing — a price overlay shares the candles' pane.
    const paneMargins = bandsFor(['adx', 'obv', 'donchian'])
    const result = binder.sync({
      enabled: true, cs, registry: engineRegistry,
      instances: [ADX_INSTANCE, OBV_INSTANCE, DONCHIAN_INSTANCE], bars: BARS,
      adjustTime: (t) => t, resolvePlacement, plan: { fresh: true },
      paneMargins, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    })
    expect(result.bound).toBe(7)
    expect(F.callsOf('addSeries').map(c => c.args[1].priceScaleId))
      .toEqual(['adx', 'adx', 'adx', 'obv', 'right', 'right', 'right'])
    // ⭐ The stack, bottom-of-chart → top: obv sits BELOW adx.
    expect(paneMargins.obv).toEqual({ top: 0.87, bottom: 0 })
    expect(paneMargins.adx).toEqual({ top: 0.72, bottom: 0.13 })
    // TWO scale calls — one per PANE-definition SCALE (adx, obv). The price
    // overlay asserts none: `scaleOptions: null` is "the scale belongs to
    // somebody else", and writing scaleMargins there would move the candles.
    // 🔴 IT WAS FOUR — one per BINDING — UNTIL B5 TASK 8 MEASURED THE REPEAT AT
    // 11,913 px on `adx_only`. See `binder.js` TRAP #6: a second write landing
    // between two siblings' `setData` calls freezes the range on the first
    // sibling alone. The PAYLOADS are unchanged and still asserted whole.
    // ⭐ TWO DIFFERENT RANGES ON TWO ADJACENT AXES, ASSERTED TOGETHER. A range
    // leaking from one to the next is the pooled-scale hazard, and it is
    // invisible on any case that turns on one oscillator at a time.
    expect(F.callsOf('priceScale.applyOptions').map(c => c.args[0])).toEqual([
      legacyBandScale(paneMargins.adx, { autoScale: false, minimum: 0, maximum: 100 }),
      legacyBandScale(paneMargins.obv, { autoScale: true }),
    ])
    // One guide across the three, and it is ADX's.
    expect(F.count('createPriceLine')).toBe(1)
  })

  it('⭐⭐ the lane is finished — every series-expressible definition is flipped', () => {
    // The equality Task 13 deletes both sets in favour of. Asserted as a SET
    // rather than a size so a definition swapped for another cannot hold the
    // count still, and both directions are covered by the sorted comparison.
    expect(ENGINE_OWNED.size).toBe(engineRegistry.listDefinitions().length)
    expect([...ENGINE_OWNED].sort())
      .toEqual(engineRegistry.listDefinitions().map(d => d.id).sort())
    expect(ENGINE_OWNED.size, 'fourteen series-expressible natives').toBe(14)
    // ⭐⭐ B5 TASK 13 — "MIGRATED equals FLIPPED" IS NOT ASSERTABLE ANY MORE, AND
    // THAT IS THE RETIREMENT RATHER THAN A GAP. A line stood here comparing
    // `ENGINE_MIGRATED_DEF_IDS` with `ENGINE_FLIPPED_DEF_IDS`; both literals are
    // DELETED, so re-pointing it at `ENGINE_OWNED` twice would be a tautology that
    // passes for ever. The claim it made — "with `engineEnabled` deleted a
    // migrated-but-un-flipped definition is drawn by NOTHING" — is carried by the
    // two lines ABOVE, which are the whole of it now: engine-owned IS
    // registry-known, in both directions, so the intermediate state has no
    // expressible form. What still needs watching is that no hand-written render
    // block comes back, and `flipB.test.jsx` asserts that behaviourally.
    // …and volumeProfile is in NEITHER, structurally: it is not series-expressible
    // (a horizontal histogram against the price axis, drawn on its own canvas), so
    // it has no definition to flip and is carved out by name.
    expect(ENGINE_OWNED.has('volumeProfile')).toBe(false)
    expect(engineRegistry.CARVED_OUT_INDICATOR_KEYS.has('volumeProfile')).toBe(true)
    expect(engineRegistry.getDefinition('volumeProfile')).toBeNull()
  })

  it('none of the three declares a legend block, so none adds a chip', () => {
    for (const id of ['adx', 'obv', 'donchian']) {
      expect(engineRegistry.getDefinition(id).plots.filter(p => p.legend), id).toEqual([])
      expect(engineRegistry.getDefinition(id).meta.legendParams, id).toBeUndefined()
    }
    // The control that this assertion CAN fail: rsi DOES declare one.
    expect(engineRegistry.getDefinition('rsi').plots.filter(p => p.legend)).toHaveLength(1)
  })
})
