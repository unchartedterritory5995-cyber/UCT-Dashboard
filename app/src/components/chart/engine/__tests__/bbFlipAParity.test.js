import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { AUTOSCALE_EXCLUDE } from '../pool'
import * as engineRegistry from '../nativeRegistry'
import { computeBB } from '../../indicators'
import { __setPaneModeForTest } from '../paneLayout'
import { createFakeChart, makeBars } from './fakeChart'

// ─── THE FLIP-A CONTRACT FOR BOLLINGER BANDS, AS A UNIT TEST ────────────────
//
// `tools/chart_parity.py --cases engine_bb_vs_legacy` is the real proof. This is
// what protects it between parity runs: the CALLS, asserted against a literal
// transcription of `StockChart.jsx:5912-5935`.
//
// WHAT THIS HOLDS THAT THE PIXEL GATE CANNOT: which of three identical-looking
// purple lines is which. All three share one colour, so upper-and-lower swapping
// their dash pattern with middle is a picture the diff would catch, but middle
// and (say) a future centre-fill swapping is not obviously attributable. Here it
// is three named assertions.
//
// WHAT IT CANNOT HOLD: creation ORDER relative to the volume bars and the MA
// overlays (LWC z-orders by insertion and BB is drawn OVER both), and the price
// scale's autoscale behaviour, which is a renderer decision. Both are the pixel
// gate's job.

/** `chart.addSeries(LineSeries, <this>)` × 3 — `:5922-5926`, verbatim.
 *  NOTE: the legacy block passes NO `priceScaleId`. Verified in the installed
 *  5.2.0 bundle (`_private__addSeriesToPane` → `_internal_defaultVisiblePriceScaleId`)
 *  that an absent id resolves to the one visible scale, which this chart
 *  configures as `right` — so naming it explicitly is byte-identical on a create
 *  and is the FIX on a re-purpose (B2 review finding C-2). */
const LEGACY_BB = [
  { key: 'upper',  lineStyle: 2 },
  { key: 'middle', lineStyle: 0 },
  { key: 'lower',  lineStyle: 2 },
]
const LEGACY_SHARED = {
  color: 'rgba(156,39,176,0.85)',
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}

/** The options the engine states that the legacy block does not — each one equal
 *  to the value a freshly-created LWC 5.2.0 series already has, so a CREATED
 *  series is byte-identical and a RE-PURPOSED one is reset to it.
 *
 *  `priceScaleId` is the one entry that is NOT a restatement of an LWC default
 *  (LWC's is `'right'` only by way of `_internal_defaultVisiblePriceScaleId`
 *  resolving the single visible scale). It is here because it is byte-identical
 *  on a create and load-bearing on a re-purpose — see the note above. */
const LWC_LINE_DEFAULTS_RESTATED = {
  visible: true,
  lineType: 0,
  pointMarkersVisible: false,
  pointMarkersRadius: 3,
  priceFormat: { type: 'price', precision: 2 },
}

const BARS = makeBars(260)
const PERIOD = 20
const STDDEV = 2
const COLOR = 'rgba(156,39,176,0.85)'
const INSTANCE = {
  instanceId: 'legacy:bb', defId: 'bb', defVersion: 1,
  inputs: { period: PERIOD, stdDev: STDDEV, color: COLOR },
  placement: { target: 'price' }, hidden: false,
}

// ⭐ B5 TASK 12 — THIS FILE DESCRIBES THE GEOMETRY THE FLIP REVERSES TO.
// `PANE_MODE` is `'panes'` since Task 12. BB itself is a PRICE overlay and
// resolves identically in both modes (the `target === 'price'` branch returns
// before `paneMode()` is ever consulted), but the C-2 repro at the bottom binds
// a REAL RSI instance to build the tenant BB is re-purposed out of — and an
// unpinned RSI resolves through the PANES branch, finds no `ctx.paneLayout`,
// binds nothing, and leaves that case with no tenant at all. The bands mode is
// still live and tested, so the MODE is pinned rather than the repro rewritten.
beforeEach(() => { __setPaneModeForTest('bands') })
afterEach(() => { __setPaneModeForTest(null) })

const sync = () => {
  const F = createFakeChart()
  const binder = createBinder({ chart: F.chart, LWC: F.LWC })
  const result = binder.sync({
    enabled: true, registry: engineRegistry, instances: [INSTANCE], bars: BARS,
    adjustTime: (t) => t, resolvePlacement,
    paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    plan: { fresh: true },
  })
  return { F, binder, result }
}

describe('BB Flip A — three series, the legacy options, nothing else', () => {
  it('creates exactly three LineSeries, in upper/middle/lower order', () => {
    const { F, result } = sync()
    expect(result.bound).toBe(3)
    expect(F.count('addSeries')).toBe(3)
    expect(F.seriesCreated.map(s => String(s.__ctor))).toEqual(['LineSeries', 'LineSeries', 'LineSeries'])
    // Order is declaration order, which is legacy order (`BB_BANDS`, :5914-5918).
    // It matters: LWC z-orders by insertion and the three overlap the candles.
    expect(result.bound).toBe(LEGACY_BB.length)
  })

  it('each series carries the legacy options VERBATIM, plus restated defaults', () => {
    const { F } = sync()
    const calls = F.callsOf('addSeries')
    expect(calls).toHaveLength(LEGACY_BB.length)
    calls.forEach((call, i) => {
      const opts = call.args[1]
      const spec = LEGACY_BB[i]
      expect(opts, spec.key).toMatchObject({ ...LEGACY_SHARED, lineStyle: spec.lineStyle })
      expect(opts, spec.key).toMatchObject(LWC_LINE_DEFAULTS_RESTATED)
      // EXHAUSTIVE, the way `rsiFlipAParity` is. `toMatchObject` alone cannot see
      // an option the engine states and the legacy block does not — a stray
      // `lastValueVisible: true` would put an axis tag on the price scale that
      // the hand-written block never drew, and both assertions above would still
      // pass. Anything the engine emits has to be named here or in one of the two
      // tables above, which is what makes those tables an account rather than a
      // sample.
      expect(opts, spec.key).toEqual({
        ...LEGACY_SHARED,
        ...LWC_LINE_DEFAULTS_RESTATED,
        lineStyle: spec.lineStyle,
        priceScaleId: 'right',
        autoscaleInfoProvider: AUTOSCALE_EXCLUDE,
      })
    })
  })

  it('all three are EXCLUDED from the candles\' autoscale', () => {
    // `:5925` — `autoscaleInfoProvider: () => null` on all three. Without it a
    // band 3σ above price stretches the candles' range and the whole chart
    // re-scales. This is the option Task 1 exists to deliver.
    const { F } = sync()
    const calls = F.callsOf('addSeries')
    expect(calls).toHaveLength(3)
    for (const call of calls) {
      expect(call.args[1].autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
    }
  })

  it('binds to the CANDLES\' scale, and asserts NOTHING on it', () => {
    const { F } = sync()
    const calls = F.callsOf('addSeries')
    expect(calls).toHaveLength(3)
    for (const call of calls) {
      expect(call.args[1].priceScaleId).toBe('right')
      expect(call.args[2], 'a price overlay lives in pane 0').toBe(0)
    }
    // The candles' margins come from `_mainMargins` and the user's dragged
    // placement. An indicator writing scaleMargins there MOVES THE CANDLES.
    expect(F.callsOf('priceScale.applyOptions')).toHaveLength(0)
  })

  it('draws no guides — BB has none', () => {
    const { F } = sync()
    expect(F.count('createPriceLine')).toBe(0)
  })

  it('makes NO other renderer call — nothing removed, nothing moved, nothing extra', () => {
    // The legacy block's create path is exactly: addSeries · _applyData, three
    // times. Anything else on a first bind is a call the migration added.
    const { F } = sync()
    expect(F.methodsUsed().sort()).toEqual(['addSeries', 'setData'])
  })

  it('the numbers are computeBB\'s, unrounded, NaN → whitespace', () => {
    const { F } = sync()
    const raw = computeBB(BARS, PERIOD, STDDEV)
    const sets = F.callsOf('setData').map(c => c.args[0])
    expect(sets).toHaveLength(3)
    for (const [i, key] of ['upper', 'middle', 'lower'].entries()) {
      const points = sets[i]
      expect(points).toHaveLength(BARS.length)
      for (let b = 0; b < BARS.length; b++) {
        const expected = raw[key][b] ? raw[key][b].value : undefined
        if (Number.isFinite(expected)) {
          expect(points[b].value, `${key}@${b}`).toBe(expected)
        } else {
          expect(points[b], `${key}@${b} must be a whitespace item`).toEqual({ time: BARS[b].t })
        }
      }
    }
    // Not vacuous in either direction: real numbers at the tail, whitespace at
    // the head. Three all-whitespace columns would satisfy the loop above against
    // three all-whitespace legacy arrays and prove nothing at all.
    for (const points of sets) {
      expect(points.at(-1).value).toBeGreaterThan(0)
      expect(points[0].value).toBeUndefined()
    }
    // …and the three are DISTINCT. `upper > middle > lower` at every computable
    // bar is what says the columns were not all wired to the same one — the exact
    // failure `computeFor`'s key re-mapping could make, and one the pixel gate
    // would see only as a band that lost its width.
    const [up, mid, low] = sets
    const last = BARS.length - 1
    expect(up[last].value).toBeGreaterThan(mid[last].value)
    expect(mid[last].value).toBeGreaterThan(low[last].value)
  })

  it('the user\'s colour reaches all three, not the definition default', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    binder.sync({
      enabled: true, registry: engineRegistry, bars: BARS, adjustTime: (t) => t, resolvePlacement,
      instances: [{ ...INSTANCE, inputs: { ...INSTANCE.inputs, color: '#00ff00' } }],
      paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
      plan: { fresh: true },
    })
    const calls = F.callsOf('addSeries')
    expect(calls).toHaveLength(3)
    for (const call of calls) expect(call.args[1].color).toBe('#00ff00')
  })

  it('the user\'s stdDev reaches the compute — a wider band is a different picture', () => {
    // `period` and `stdDev` are the two numeric inputs, and neither shows up in
    // an option object: they only exist in the NUMBERS. An adapter that dropped
    // `stdDev` would draw a perfectly legal-looking BB at the definition default
    // and every option assertion above would still pass.
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    binder.sync({
      enabled: true, registry: engineRegistry, bars: BARS, adjustTime: (t) => t, resolvePlacement,
      instances: [{ ...INSTANCE, inputs: { ...INSTANCE.inputs, stdDev: 3 } }],
      paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
      plan: { fresh: true },
    })
    const [upper] = F.callsOf('setData').map(c => c.args[0])
    const raw3 = computeBB(BARS, PERIOD, 3)
    const raw2 = computeBB(BARS, PERIOD, STDDEV)
    const last = BARS.length - 1
    expect(upper[last].value).toBe(raw3.upper[last].value)
    expect(raw3.upper[last].value).not.toBe(raw2.upper[last].value)
  })

  it('C-2, the exact repro: RSI released then BB bound keeps NOTHING of the rsi scale', () => {
    // The B2 final review's Critical #2 was measured on this pair. A pooled
    // series that kept `priceScaleId: 'rsi'` put BB's upper band on a
    // {autoScale:false, min:0, max:100} axis, clipped invisible, with
    // `scaleOptions:null` meaning nothing corrected it.
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const ctx = (instances) => ({
      enabled: true, registry: engineRegistry, instances, bars: BARS,
      adjustTime: (t) => t, resolvePlacement,
      paneMargins: { rsi: { top: 0.85, bottom: 0 } },
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1, plan: { fresh: true },
    })
    binder.sync(ctx([{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false }]))
    // The state the repro needs, asserted rather than assumed: the series that is
    // about to be re-purposed really is sitting on the `rsi` scale with three
    // guides on it. Without this the second half could pass against a first sync
    // that bound nothing.
    const rsiCreate = F.callsOf('addSeries')
    expect(rsiCreate, 'RSI bound nothing — the re-purpose below has no tenant').toHaveLength(1)
    expect(rsiCreate[0].args[1].priceScaleId).toBe('rsi')
    expect(F.count('createPriceLine'), 'RSI left no guides to inherit').toBe(3)
    F.reset()
    binder.sync(ctx([INSTANCE]))

    const applied = F.callsOf('applyOptions').map(c => c.args[0])
    expect(applied.length, 'nothing was re-purposed — this case is vacuous').toBeGreaterThan(0)
    for (const opts of applied) {
      expect(opts.priceScaleId).toBe('right')
      expect(opts.autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
    }
    // …and NOTHING re-asserts the rsi band's margins on the candles' axis.
    expect(F.callsOf('priceScale.applyOptions')).toHaveLength(0)
    // …and every guide RSI left behind is gone.
    expect(F.count('removePriceLine')).toBe(3)
  })
})
