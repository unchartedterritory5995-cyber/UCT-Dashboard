import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { AUTOSCALE_EXCLUDE } from '../pool'
import { eligibleInstances } from '../eligibility'
import * as engineRegistry from '../nativeRegistry'
import { computeVWAP } from '../../indicators'
import { createFakeChart } from './fakeChart'
import fixture from '../../../../pages/parityBars/intraday5m.json'

// ─── THE FLIP-A CONTRACT FOR SESSION VWAP ───────────────────────────────────
//
// Driven by the INTRADAY fixture, not `makeBars`: VWAP is timeframe-gated and a
// daily-bar test of it would assert on an indicator that does not exist.
//
// ⚠️ THE BUCKETING MOVED, IN ITS OWN COMMIT, AFTER THIS FILE WAS WRITTEN.
// `computeVWAP` used to restart its accumulator on a UTC calendar day, which is
// wrong for extended hours — 20:00 ET is 00:00 UTC the next day, and on an EST
// session the same boundary lands at 19:00, THIRTEEN BARS inside the post-market.
// Worse, once Monday evening had opened UTC day 11-04, Tuesday's 04:00 ET open
// was not a UTC-day boundary at all and never reset: the chart opened that
// session reading 93.9178 where a session-anchored VWAP reads 108.3633,
// **$14.45 wrong**, and stayed >$0.50 wrong for 120 of that session's 193 bars.
//
// `VWAP_SESSION_ANCHOR` (`docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`,
// spec §11) was ACCEPTED 2026-08-03 at a measured 2,590 changed pixels, in a
// commit of its own carrying a `compute.rev` bump — never inside this migration,
// because both lanes read `computeVWAP` and a correction moves A and B together,
// so `engine_vwap_vs_legacy` would still have reported 0 while the picture
// changed underneath it.
//
// Flip A still draws what the shipped chart draws. That is why the value case
// below MOVED rather than being deleted: it is the assertion that would catch a
// revert as loudly as it caught the change.

const BARS = fixture.bars

/** `chart.addSeries(LineSeries, <this>)` — `StockChart.jsx:6010-6014`, verbatim. */
const LEGACY_VWAP = {
  color: '#26C6DA', lineWidth: 1, lineStyle: 0,
  priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
}

/** The options the engine states that the legacy block does not — each equal to
 *  the value a freshly-created LWC 5.2.0 series already has, so a CREATED series
 *  is byte-identical and a RE-PURPOSED one is reset to it. `priceScaleId` is the
 *  one that is not a restatement: legacy passes none and LWC resolves the single
 *  visible scale, which this chart configures as `right`. */
const LWC_LINE_DEFAULTS_RESTATED = {
  visible: true,
  lineType: 0,
  pointMarkersVisible: false,
  pointMarkersRadius: 3,
  priceFormat: { type: 'price', precision: 2 },
  priceScaleId: 'right',
}

// ⭐ B5 TASK 12 — AND WHY THIS FILE NEEDS NO `__setPaneModeForTest`.
// Every sibling Flip-A suite that binds an OSCILLATOR pins `'bands'`, because
// `PANE_MODE` is `'panes'` now and an unpinned oscillator lands in a REAL pane
// on a `'right'` scale with zero margins. VWAP is a PRICE OVERLAY, and
// `resolvePlacement`'s `target === 'price'` branch returns before `paneMode()`
// is ever read — so every expectation below is the SHIPPED answer in both modes.
// Pinning would only narrow what this file covers while claiming a
// mode-dependence it does not have.

const INSTANCE = {
  instanceId: 'legacy:vwap', defId: 'vwap', defVersion: 1,
  inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
  placement: { target: 'price' }, hidden: false,
}

const sync = (inst = INSTANCE, elig = { tf: '5' }, extra = {}) => {
  const F = createFakeChart()
  const binder = createBinder({ chart: F.chart, LWC: F.LWC })
  const { kept, hidden } = eligibleInstances([inst], engineRegistry, elig)
  const result = binder.sync({
    enabled: true, registry: engineRegistry, instances: kept, bars: BARS,
    adjustTime: (t) => t, resolvePlacement,
    paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    plan: { fresh: true }, ...extra,
  })
  return { F, binder, result, kept, hidden }
}

const opts = (F, i = 0) => F.callsOf('addSeries')[i].args[1]

describe('VWAP Flip A — one line on the candles\' scale, intraday only', () => {
  it('the fixture is the INTRADAY one, and it is the one Task 7 measured', () => {
    // Non-vacuity for everything below: a daily fixture would make the timeframe
    // gate untestable and would silently retire the UTC-day evidence.
    expect(BARS).toHaveLength(579)
    expect(fixture.tf).toBe('5')
  })

  it('creates one LineSeries with the legacy options verbatim', () => {
    const { F, result } = sync()
    expect(result.bound).toBe(1)
    expect(F.count('addSeries')).toBe(1)
    expect(String(F.seriesCreated[0].__ctor)).toBe('LineSeries')
    expect(opts(F)).toMatchObject(LEGACY_VWAP)
    expect(opts(F).autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
  })

  it('states nothing the legacy block does not, beyond the restated defaults', () => {
    // The complete-key-set rule (C-1) means the engine WRITES more keys than the
    // legacy `addSeries` call does. Every extra one has to be the value LWC would
    // already hold, or a create is not byte-identical. Exhaustive, not `toMatchObject`:
    // a key that is neither legacy's nor a restated default is a real difference.
    const { F } = sync()
    expect(opts(F)).toEqual({
      ...LEGACY_VWAP, ...LWC_LINE_DEFAULTS_RESTATED,
      autoscaleInfoProvider: AUTOSCALE_EXCLUDE,
    })
  })

  it('asserts NOTHING on the candles\' price scale', () => {
    // Task 1's seam. A price overlay is a GUEST on the candles' axis: writing
    // `scaleMargins` there moves the candles, and it was measured at 38,491 px on
    // the main scale. `autoscale: 'exclude'` is the other half — the line must not
    // stretch the axis either, which is exactly `autoscaleInfoProvider: () => null`
    // in the legacy block.
    const { F } = sync()
    expect(F.callsOf('priceScale.applyOptions'), 'must assert nothing on the candles\' axis').toHaveLength(0)
  })

  it('lands on pane 0, on the scale the CANDLES own', () => {
    const { F } = sync()
    expect(F.callsOf('addSeries')[0].args[2]).toBe(0)
    expect(opts(F).priceScaleId).toBe('right')
  })

  it('draws NOTHING on a daily chart', () => {
    const { F, result, hidden } = sync(INSTANCE, { tf: 'D' })
    expect(result.bound).toBe(0)
    expect(F.count('addSeries')).toBe(0)
    expect(hidden.map(h => h.reason)).toEqual(['timeframe'])
  })

  it('composes colour × opacity into the SERIES colour', () => {
    const { F } = sync({ ...INSTANCE, inputs: { ...INSTANCE.inputs, opacity: 40 } })
    expect(opts(F).color).toBe('rgba(38, 198, 218, 0.4)')
  })

  it('the user\'s LINE STYLE reaches the series — solid, dashed and dotted', () => {
    // ⚠️ THE ONE THE DEFINITION COULD NOT SAY UNTIL THIS TASK. `lineStyle` was
    // not a substitutable plot field, so the plot carried an author's literal and
    // the engine drew SOLID for every user who had chosen dashed. Legacy's map is
    // `{solid: 0, dotted: 1, dashed: 2}` (`:6004`), which is the LWC enum itself.
    // Measured on a build carrying the migration but not the fix (`9c7b7e62e647`):
    // `engine_vwap_dashed_vs_legacy` = 2,966 changed px on 5/5, while
    // `engine_vwap_vs_legacy` (lineStyle solid) = 0 on that same build.
    for (const [name, value] of [['solid', 0], ['dashed', 2], ['dotted', 1]]) {
      const { F } = sync({ ...INSTANCE, inputs: { ...INSTANCE.inputs, lineStyle: name } })
      expect(opts(F).lineStyle, name).toBe(value)
    }
  })

  it('vwapOverride recolours the line and leaves its width alone', () => {
    const { F } = sync({ ...INSTANCE, inputs: { ...INSTANCE.inputs, lineWidth: 2 } },
      { tf: '5', vwapOverride: { color: '#ffffff' } })
    expect(opts(F).color).toBe('#ffffff')
    expect(opts(F).lineWidth).toBe(2)
  })

  it('an unset width takes 0.5 on the Model Book look', () => {
    const bare = { ...INSTANCE, inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid' } }
    expect(opts(sync(bare, { tf: '5' }).F).lineWidth).toBe(1)
    expect(opts(sync(bare, { tf: '5', modelBookLook: true }).F).lineWidth).toBe(0.5)
    expect(opts(sync(bare, { tf: '5', boldCandles: true }).F).lineWidth).toBe(0.5)
  })

  it('the numbers are computeVWAP\'s, session resets and all', () => {
    const { F } = sync()
    const raw = computeVWAP(BARS)
    const points = F.callsOf('setData')[0].args[0]
    expect(points).toHaveLength(BARS.length)
    for (let i = 0; i < BARS.length; i++) expect(points[i].value, `bar ${i}`).toBe(raw[i].value)
  })

  it('…and those numbers are the ET-SESSION ones, at the bars that prove it', () => {
    // The transcription check above compares the engine to `computeVWAP`, so it
    // stays green if `computeVWAP` itself changes. These four are the actual
    // shipped VALUES at the bars where the two bucketings disagree, measured by
    // Task 7 and applied by `VWAP_SESSION_ANCHOR` on 2026-08-03. Together with
    // `vwapUtcBucketing.test.js` they make "the maths moved" a red test rather
    // than a silent re-baseline — in EITHER direction, including a revert.
    const points = sync().F.callsOf('setData')[0].args[0]
    const at = (i) => Number(points[i].value.toFixed(4))
    expect(at(192), 'Fri 20:00 EDT — no longer wiped at 11-01 00:00 UTC').toBe(101.9471)
    expect(at(373), 'Mon 19:00 EST — the hour that used to MOVE').toBe(96.4361)
    expect(at(386), 'Tue 04:00 EST — the open, $14.45 off under UTC-day bucketing').toBe(108.3633)
    expect(at(566), 'Tue 19:00 EST').toBe(109.4466)
  })

  it('draws no guides, and its ONE plot declares the chip Task 2 gave it', () => {
    // 🔴 THIS READ *"draws no guides and produces no legend chip"* and asserted
    // `plots[0].legend.hide === true`. The guide half is unchanged; the chip half
    // was the DEFECT — a dollar line on the candles' own scale with no label at
    // any time. Task 2 (`43efeff6`) replaced `{ hide: true }` with
    // `{ decimals: 2 }`, the same precision `ichimoku`'s TK/KJ print.
    //
    // ⛔ THE DECLARATION IS ASSERTED WHOLE (`toEqual`), NOT PROBED. `hide`
    // returning to `true` fails it, a precision change fails it, and a
    // `legendParams` appearing fails the line below — VWAP's four inputs are
    // colour/opacity/style/width and not one of them changes WHAT IS MEASURED,
    // so `VWAP(100)` would be a bracket that means nothing.
    const { F } = sync()
    expect(F.count('createPriceLine')).toBe(0)
    const def = engineRegistry.getDefinition('vwap')
    expect(def.plots).toHaveLength(1)
    expect(def.plots[0].legend, 'VWAP\'s chip declaration moved').toEqual({ decimals: 2 })
    expect(def.meta.legendParams, 'a cosmetic input reached the chip').toBeUndefined()
  })

  it('a POOLED series is re-fed, never destroyed and recreated (#2049)', () => {
    // C-2's twin for a price overlay. A colour change must re-STYLE the series
    // the user is already looking at.
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, registry: engineRegistry, instances: eligibleInstances([inst], engineRegistry, { tf: '5' }).kept,
      bars: BARS, adjustTime: (t) => t, resolvePlacement,
      paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
      plan: { fresh: true },
    })
    run(INSTANCE)
    run({ ...INSTANCE, inputs: { ...INSTANCE.inputs, color: '#ff0000', lineStyle: 'dashed' } })
    expect(F.count('addSeries'), 'a restyle must not create a second series').toBe(1)
    expect(F.count('removeSeries'), 'a restyle must not destroy the series').toBe(0)
    const applied = F.callsOf('applyOptions').filter(c => c.on === 'series')
    expect(applied.length).toBeGreaterThan(0)
    expect(applied[applied.length - 1].args[0].color).toBe('#ff0000')
    expect(applied[applied.length - 1].args[0].lineStyle).toBe(2)
  })

  it('the second pass re-asserts the COMPLETE option set, not a delta', () => {
    // TRAP #2 read from the series side: `merge()` skips `undefined`, so an option
    // omitted on a re-bind keeps whatever the previous tenant left. Every key that
    // can be set has to be set every time.
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const run = (inst) => binder.sync({
      enabled: true, registry: engineRegistry, instances: eligibleInstances([inst], engineRegistry, { tf: '5' }).kept,
      bars: BARS, adjustTime: (t) => t, resolvePlacement,
      paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
      plan: { fresh: true },
    })
    run(INSTANCE)
    run({ ...INSTANCE, inputs: { ...INSTANCE.inputs, color: '#ff0000' } })
    const second = F.callsOf('applyOptions').filter(c => c.on === 'series')[0].args[0]
    expect(Object.keys(second).sort()).toEqual(Object.keys(opts(F)).sort())
  })

  it('makes NO other renderer call — the WHOLE call list is two entries', () => {
    // Exhaustive rather than a list of `toBe(0)`s: a `toBe(0)` per method can
    // only fail on a method somebody thought to name, and the failures this
    // branch has actually shipped (an orphaned guide, a stray scale write, a
    // moveToPane) were all methods nobody had listed.
    const { F } = sync()
    expect(F.methodsUsed()).toEqual(['addSeries', 'setData'])
  })
})
