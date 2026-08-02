import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import * as engineRegistry from '../nativeRegistry'
import { computeRSI } from '../../indicators'
import { computePaneMargins } from '../../paneMargins'
import { createFakeChart, makeBars } from './fakeChart'

// ─── THE FLIP-A CONTRACT FOR RSI, AS A UNIT TEST (Task 8) ───────────────────
//
// `tools/chart_parity.py --cases engine_rsi_vs_legacy` is the real proof: it
// renders RSI through the legacy block and through the engine on one build and
// diffs the two PNGs. It also needs Playwright, Chromium, a static server and
// ~40 seconds, so it is not something CI runs on every commit — which means the
// thing that actually protects this in the day-to-day is right here.
//
// WHAT THIS HOLDS THAT THE PIXEL GATE CANNOT: the pixel gate says "the picture
// is the same". It does not say WHY, and it cannot tell "identical because the
// options match" from "identical because two mistakes cancelled". This asserts
// the CALLS — every option, the pane index, the complete price-scale set and all
// three guides — against a literal transcription of `StockChart.jsx`'s RSI block
// (`:5871-5895`). If someone edits that block, this test is what says so.
//
// WHAT IT CANNOT HOLD, and why the pixel gate still has to exist: series
// CREATION ORDER (LWC z-orders by it, and the engine's call site sits before the
// volume block), pane geometry, and anything the renderer decides for itself —
// which is exactly the class the 379-pixel finding below lived in.
//
// ⚠️ THE FINDING THIS TEST WAS WRITTEN AROUND. The first run of the rehearsal
// was **379 changed pixels**, all on one row: RSI's 50 midline. The legacy block
// passes `lineStyle: 3` (LWC LargeDashed) to `createPriceLine`; the definition
// declared NO lineStyle, because the schema's vocabulary could not name that
// style. An OMITTED series option means "keep what's there" — but an omitted
// `createPriceLine` option means "use LWC's default", and LWC's price-line
// default is Dashed (2). 6-on/6-off rendered as 2-on/2-off. Hence
// `LEGACY_PRICE_LINES` below is written out in full, `lineStyle` included: a
// guide that does not name its style is not "unopinionated", it is wrong.

// ─── the literal transcription ──────────────────────────────────────────────
// StockChart.jsx:5875-5886, verbatim. Do not "tidy" these — their whole value is
// that they are a copy of the shipped call, not a derivation of it.

/** `chart.addSeries(LineSeries, <this>, rsiTgt.pane)` — `:5875-5882`. */
const LEGACY_SERIES_OPTIONS = {
  priceScaleId: 'rsi',
  color: '#7b68ee',
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}

/**
 * The options the engine states that the legacy block does NOT — every one of
 * them equal to the value a freshly-created LWC series already has, verbatim from
 * `lightweight-charts@5.2.0`'s `seriesOptionsDefaults` + `lineStyleDefaults`.
 *
 * The engine emits a COMPLETE option set for a plot's pool key on every bind,
 * because `applyOptions` MERGES and a partial object let a re-purposed series
 * inherit its previous tenant's styling (an RSI line drawn with SAR's point
 * markers, an MFI drawn with Stochastic %D's dashes). Those extra keys are the
 * price of that, and their correctness is exactly this claim: **each one restates
 * a default, so a CREATED series is byte-identical to the legacy one and a
 * RE-PURPOSED one is reset to it.** If a value here ever stops matching LWC's
 * default, the create path has started drawing something the legacy block did
 * not — which is what the 0-pixel rehearsal would then fail on.
 *
 * `pointMarkersRadius` is the one entry with no LWC default: the option is
 * optional and only read when `pointMarkersVisible` is true
 * (`pointMarkersVisible ? (pointMarkersRadius || lineWidth/2 + 2) : undefined`),
 * so on a non-markers plot it is inert and exists only to keep the key set
 * uniform. It cannot be omitted-to-reset either — LWC's `merge` skips `undefined`.
 */
const LWC_LINE_DEFAULTS_RESTATED = {
  visible: true,          // seriesOptionsDefaults.visible
  lineStyle: 0,           // lineStyleDefaults.lineStyle    = LineStyle.Solid
  lineType: 0,            // lineStyleDefaults.lineType     = LineType.Simple
  pointMarkersVisible: false, // lineStyleDefaults.pointMarkersVisible
  pointMarkersRadius: 3,  // no LWC default — inert while pointMarkersVisible is false
  // seriesOptionsDefaults.priceFormat.precision. The legacy RSI block sets no
  // `priceFormat` at all, so this IS a restatement: LWC's `merge` recurses into
  // a nested plain object, leaving the series' own `minMove: 0.01` in place, and
  // the resulting format is the one a fresh series already had. It is emitted on
  // every pool key so that `plots[].precision` — validated by `defSchema` for any
  // plot and, until now, read only for histograms — actually reaches the series,
  // and so a pooled series cannot inherit the last tenant's decimals.
  priceFormat: { type: 'price', precision: 2 },
}

/** `applyIndScale('rsi', …, { autoScale: false, minimum: 0, maximum: 100 })` —
 *  `:5883`, expanded through `applyIndScale`'s non-`left` branch (`:5502-5510`).
 *  The fixed range reaches the scale on the CREATE branch only in the shipped
 *  code; the engine asserts the whole set on EVERY bind (binder trap #2), which
 *  is what a pooled series needs and is a superset of what legacy does. */
const legacyScaleOptions = (band) => ({
  borderVisible: false,
  scaleMargins: band,
  autoScale: false,
  minimum: 0,
  maximum: 100,
})

/** The three `createPriceLine` calls — `:5884-5886`. */
const LEGACY_PRICE_LINES = [
  { price: 70, color: 'rgba(123,104,238,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false },
  { price: 50, color: 'rgba(123,104,238,0.2)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false },
  { price: 30, color: 'rgba(123,104,238,0.4)', lineWidth: 1, lineStyle: 2, axisLabelVisible: false },
]

// ─── the fixture ────────────────────────────────────────────────────────────

const BARS = makeBars(260)
const PERIOD = 14
const COLOR = '#7b68ee'

const RSI_INSTANCE = {
  instanceId: 'legacy:rsi',
  defId: 'rsi',
  defVersion: 1,
  inputs: { period: PERIOD, color: COLOR },
  placement: { target: 'pane' },
  hidden: false,
}

/** The `cs` the parity case pins: RSI on, volume in its own pane. Its ONLY job
 *  is to feed `computePaneMargins`, which is what reserves RSI's band — and the
 *  reason the legacy toggle has to stay ON under Flip A. */
const CS = { indicators: { rsi: { enabled: true, period: PERIOD, color: COLOR } } }
const PANE_MARGINS = computePaneMargins(CS, false, new Set())

const syncOnce = (fake, over) => {
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const result = binder.sync({
    enabled: true,
    cs: CS,
    instances: [RSI_INSTANCE],
    registry: engineRegistry,
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    paneMargins: PANE_MARGINS,
    volOverlaySet: new Set(),
    volSeparatePane: true,
    VOL_PANE_INDEX: 1,
    resolvePlacement,
    ...over,
  })
  return { binder, result }
}

describe('RSI Flip A — the engine makes the legacy calls, argument for argument', () => {
  it('reserves a band at all (otherwise every assertion below is about nothing)', () => {
    expect(PANE_MARGINS.rsi).toEqual({ top: 0.85, bottom: 0 })
  })

  it('creates ONE LineSeries in pane 0 with exactly the legacy options', () => {
    const fake = createFakeChart()
    const { result } = syncOnce(fake)
    expect(result.ok).toBe(true)
    expect(result.bound).toBe(1)

    const created = fake.callsOf('addSeries')
    expect(created).toHaveLength(1)
    const [ctor, options, paneIndex] = created[0].args

    expect(ctor).toBe(fake.LWC.LineSeries)
    // Flip A draws into a BAND inside pane 0, not a real pane. A `1` here is the
    // B5 change arriving early, and it would move every other series down.
    expect(paneIndex).toBe(0)
    // Two halves, and the second is the one that matters. Every legacy option,
    // with the legacy value — and then an EXHAUSTIVE account of everything else
    // the engine states, each entry a restatement of the default a fresh series
    // already had. `toEqual` on the whole object is what makes it exhaustive: an
    // engine series carrying, say, `lastValueVisible: true` puts an axis tag on
    // the chart that the hand-written block never drew, and an extra key that is
    // NOT in `LWC_LINE_DEFAULTS_RESTATED` fails here rather than in a pixel diff.
    expect(options).toMatchObject(LEGACY_SERIES_OPTIONS)
    expect(options).toEqual({ ...LEGACY_SERIES_OPTIONS, ...LWC_LINE_DEFAULTS_RESTATED })
  })

  it('asserts the FULL price-scale set — band margins AND the 0-100 fixed range', () => {
    const fake = createFakeChart()
    syncOnce(fake)

    const scaleCalls = fake.callsOf('priceScale.applyOptions')
    expect(scaleCalls).toHaveLength(1)
    expect(scaleCalls[0].args[0]).toEqual(legacyScaleOptions(PANE_MARGINS.rsi))
  })

  it('re-asserts that whole set on a SECOND pass, where legacy asserts only half', () => {
    // Trap #2. `applyIndScale` gets no `bandExtra` on the update branch, so the
    // 0-100 range survives today only because the series and its scale are born
    // together. A pooled series has no such luck — every bind, the whole object.
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const ctx = {
      enabled: true, cs: CS, instances: [RSI_INSTANCE], registry: engineRegistry,
      bars: BARS, adjustTime: (t) => t, plan: { fresh: true },
      paneMargins: PANE_MARGINS, volOverlaySet: new Set(), volSeparatePane: true,
      VOL_PANE_INDEX: 1, resolvePlacement,
    }
    binder.sync(ctx)
    binder.sync(ctx)

    const scaleCalls = fake.callsOf('priceScale.applyOptions')
    expect(scaleCalls).toHaveLength(2)
    for (const call of scaleCalls) {
      expect(call.args[0]).toEqual(legacyScaleOptions(PANE_MARGINS.rsi))
    }
  })

  it('draws the three 70 / 50 / 30 guides with the legacy colour, width AND lineStyle', () => {
    const fake = createFakeChart()
    syncOnce(fake)

    const lines = fake.callsOf('createPriceLine').map(c => c.args[0])
    expect(lines).toHaveLength(3)

    // Compared by PRICE, not by call order. The engine emits 70, 30, 50 (one
    // `hlines` plot per style, and `bands` carries both outer levels) where the
    // shipped block emits 70, 50, 30. These are three non-overlapping horizontal
    // lines on one scale, so the order cannot change a pixel — and the parity
    // gate is the thing that certifies that claim, at 0 changed pixels.
    const byPrice = (a, b) => b.price - a.price
    expect([...lines].sort(byPrice)).toEqual([...LEGACY_PRICE_LINES].sort(byPrice))
  })

  it('sets exactly the data the legacy block would have set', () => {
    const fake = createFakeChart()
    syncOnce(fake)

    // `indicatorData.rsi` = `computeRSI(bars, period).map(p => indPoint(adjustTime(p.time), p.value))`
    // (`StockChart.jsx:3927` + `:3969`). `indPoint` drops the value when it is not
    // finite, which is how a not-yet-computable bar becomes an LWC whitespace item.
    const legacyPoints = computeRSI(BARS, PERIOD)
      .map(p => (Number.isFinite(p.value) ? { time: p.time, value: p.value } : { time: p.time }))

    const setDataCalls = fake.callsOf('setData')
    expect(setDataCalls).toHaveLength(1)
    const points = setDataCalls[0].args[0]

    expect(points).toHaveLength(BARS.length)
    expect(points).toEqual(legacyPoints)
    // Not vacuous in either direction: real numbers at the tail, whitespace at
    // the head. An all-whitespace column would satisfy `toEqual` against an
    // all-whitespace legacy array and prove nothing.
    expect(points.at(-1).value).toBeGreaterThan(0)
    expect(points[0].value).toBeUndefined()
  })

  it('makes NO other renderer call — nothing removed, nothing moved, nothing extra', () => {
    // The legacy block's create path is exactly: addSeries · priceScale.applyOptions ·
    // createPriceLine ×3 · _applyData. Anything else the engine does on a first
    // bind is a call the migration added, and this is where that shows up.
    const fake = createFakeChart()
    syncOnce(fake)
    expect(fake.methodsUsed().sort()).toEqual(
      ['addSeries', 'createPriceLine', 'priceScale.applyOptions', 'setData'],
    )
  })
})
