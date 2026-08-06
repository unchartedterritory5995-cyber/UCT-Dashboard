import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBinder } from './binder'
import { resolvePlacement as realPlacement, MAIN_PRICE_SCALE_ID } from './placement'
import { AUTOSCALE_EXCLUDE, AUTOSCALE_DEFAULT } from './pool'
import { createFakeChart, makeBars } from './__tests__/fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from './paneLayout'
import * as registry from './nativeRegistry'

// ─── The contract under test ─────────────────────────────────────────────────
//
// Every assertion here is BEHAVIOURAL — which calls the binder makes on the
// renderer, in which order, with which arguments. None of it is about pixels;
// the parity gate owns those. What this file owns is the six things a pooling
// binder can get wrong in ways no pixel diff would catch until a user hits them:
//
//   flag off               → zero calls (the lands-dark contract)
//   a recolour             → zero addSeries / removeSeries
//   a pane move            → moveToPane + applyOptions, never remove + add
//   a first bind           → setData, never update, even under a `noop` plan
//   a reclaim              → removePriceLine for every inherited guide
//   every bind             → the FULL scale option set re-asserted

const bars = makeBars()

const inst = (defId, extra = {}) => ({
  instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra,
})

/** The complete pane-0 scale option set, including the fixed-range extras that
 *  `StockChart` applies on the CREATE branch only today (`:5773`). Trap #2 is
 *  that a pooled series inheriting RSI's chart-level 0-100 scale would clip an
 *  ATR, so this whole object has to be re-asserted on every bind. */
const RSI_SCALE = Object.freeze({
  borderVisible: false,
  scaleMargins: { top: 0.82, bottom: 0 },
  autoScale: false,
  minimum: 0,
  maximum: 100,
})

const VOLUME_OVERLAY_SCALE = Object.freeze({
  borderVisible: false, visible: true, autoScale: true,
  scaleMargins: { top: 0.12, bottom: 0.04 },
})

/** Stands in for Task 6's `placement.js`. The binder must apply what this
 *  returns verbatim — it is deliberately not allowed to compute placement
 *  itself, so every placement decision stays in one testable module. */
const placementFake = (overrides = {}) => (instance) => (
  overrides[instance.instanceId] || { paneIndex: 0, scaleId: instance.defId, scaleOptions: RSI_SCALE }
)

/** `StockChart._applyData`, faithfully: it RETURNS EARLY on a noop plan. That
 *  early return is the trap — a series bound for the first time this pass would
 *  render blank — so the binder must not route a first bind through it. */
const applyDataLike = (plan) => (series, data) => {
  if (!series || !data) return
  if (plan.noop) return
  if (plan.incr && data.length) { series.update(data[data.length - 1]); return }
  series.setData(data)
}

const ctxFor = (instances, { plan = { fresh: true }, placement = placementFake(), enabled = true } = {}) => ({
  enabled,
  instances,
  registry,
  bars,
  adjustTime: (t) => t,
  plan,
  applyData: applyDataLike(plan),
  resolvePlacement: placement,
})

let fake
let binder
beforeEach(() => {
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
})

/**
 * ⭐ B5 TASK 12 FLIPPED `PANE_MODE` TO `'panes'`, so a case whose subject is the
 * BAND geometry has to name the mode it means rather than inherit the shipped
 * one. `'bands'` is still live — `computePaneLayout` returns its map either way —
 * and it is the geometry the flip reverses TO, priced at the same numbers, which
 * is why these cases are pinned rather than retired.
 */
const pinBands = () => { __setPaneModeForTest('bands') }

afterEach(() => { __setPaneModeForTest(null) })

// ─────────────────────────────────────────────────────────────────────────────

describe('the lands-dark contract', () => {
  it('FLAG OFF ⇒ zero calls of any kind, with real instances present', () => {
    // Non-empty instances on purpose. With an empty list the plan is empty and
    // "zero calls" would be true of a binder that ignored the flag entirely —
    // the test would pass vacuously and prove nothing.
    binder.sync(ctxFor([inst('rsi'), inst('macd'), inst('bb')], { enabled: false }))

    expect(fake.calls, JSON.stringify(fake.methodsUsed())).toEqual([])
    expect(fake.seriesCreated).toEqual([])
  })

  it('an ABSENT flag is off — dark is the default, not a value you have to set', () => {
    const ctx = ctxFor([inst('rsi')])
    delete ctx.enabled
    binder.sync(ctx)
    expect(fake.calls).toEqual([])
  })

  it('teardown on a binder that never bound anything is also zero calls', () => {
    binder.teardown()
    expect(fake.calls).toEqual([])
  })

  it('no placement resolver ⇒ zero calls, rather than a guess', () => {
    // Placement is Task 6's module. A binder that invented its own would be a
    // second source of truth for pane and scale.
    const ctx = ctxFor([inst('rsi')])
    delete ctx.resolvePlacement
    const r = binder.sync(ctx)

    expect(fake.calls).toEqual([])
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/placement/i)
  })

  it('with the flag ON and zero instances it still makes no calls', () => {
    binder.sync(ctxFor([]))
    expect(fake.calls).toEqual([])
  })
})

describe('a settings change that only changes appearance', () => {
  it('a RECOLOUR makes zero addSeries and zero removeSeries', () => {
    binder.sync(ctxFor([inst('rsi', { inputs: { color: '#111111' } })]))
    expect(fake.count('addSeries')).toBe(1)

    fake.reset()
    binder.sync(ctxFor([inst('rsi', { inputs: { color: '#222222' } })]))

    expect(fake.count('addSeries')).toBe(0)
    expect(fake.count('removeSeries')).toBe(0)
    const applied = fake.callsOf('applyOptions').map(c => c.args[0].color)
    expect(applied).toContain('#222222')
  })

  it('the colour actually reaches the series options', () => {
    binder.sync(ctxFor([inst('rsi', { inputs: { color: '#abcdef' } })]))
    expect(fake.seriesCreated[0].options().color).toBe('#abcdef')
  })
})

describe('a pane move — the lightweight-charts#2049 escape', () => {
  it('moves the series and re-scales it; NEVER removes and re-adds', () => {
    // Pane and priceScaleId are BOTH mutable on 5.2.0 (moveToPane / applyOptions
    // → moveSeriesToScale). Two in-code comments in StockChart still say they are
    // fixed at creation; they were true on 5.1.x and are why the shipped code
    // destroys a series whenever its target scale changes.
    binder.sync(ctxFor([inst('rsi')]))
    const series = fake.seriesCreated[0]
    fake.reset()

    binder.sync(ctxFor([inst('rsi')], {
      placement: placementFake({
        'legacy:rsi': { paneIndex: 1, scaleId: 'left', scaleOptions: VOLUME_OVERLAY_SCALE },
      }),
    }))

    expect(fake.count('moveToPane')).toBe(1)
    expect(fake.callsOf('moveToPane')[0].args[0]).toBe(1)
    expect(fake.callsOf('applyOptions')[0].args[0].priceScaleId).toBe('left')

    expect(fake.count('removeSeries'), 'a pane move must never destroy the series').toBe(0)
    expect(fake.count('addSeries')).toBe(0)
    expect(fake.seriesCreated[0]).toBe(series)
  })

  it('does NOT move a series that is already on the right pane', () => {
    binder.sync(ctxFor([inst('rsi')]))
    fake.reset()
    binder.sync(ctxFor([inst('rsi')]))
    expect(fake.count('moveToPane')).toBe(0)
  })

  it('a POOLED series is moved to its new tenant\'s pane', () => {
    binder.sync(ctxFor([inst('rsi')]))
    fake.reset()

    binder.sync(ctxFor([inst('atr')], {
      placement: placementFake({
        'legacy:atr': { paneIndex: 2, scaleId: 'atr', scaleOptions: { borderVisible: false, autoScale: true } },
      }),
    }))

    expect(fake.count('addSeries')).toBe(0)
    expect(fake.count('removeSeries')).toBe(0)
    expect(fake.callsOf('moveToPane')[0].args[0]).toBe(2)
    expect(fake.callsOf('applyOptions')[0].args[0].priceScaleId).toBe('atr')
  })
})

describe('the first bind always gets setData — trap #1', () => {
  it('a NEWLY CREATED series is setData even under a noop plan', () => {
    binder.sync(ctxFor([inst('rsi')], { plan: { noop: true } }))

    const setData = fake.callsOf('setData')
    expect(setData).toHaveLength(1)
    expect(setData[0].args[0].length).toBe(bars.length)
    expect(fake.count('update')).toBe(0)
  })

  it('a RE-PURPOSED series is setData even under a noop plan', () => {
    // The one the coupling used to hide: every create is triggered by a `cs`
    // change today, so a fresh series can never meet a noop plan. Pooling breaks
    // that — a series can change tenant while `cs` and the bars are untouched —
    // and the re-purposed series still holds RSI's numbers.
    binder.sync(ctxFor([inst('rsi')]))
    const series = fake.seriesCreated[0]
    fake.reset()

    binder.sync(ctxFor([inst('atr')], { plan: { noop: true } }))

    const setData = fake.callsOf('setData')
    expect(setData, 'a re-purposed series must be re-populated').toHaveLength(1)
    expect(setData[0].id).toBe(series.__id)
    expect(fake.count('update')).toBe(0)
    expect(fake.count('addSeries')).toBe(0)
  })

  it('a SURVIVING binding under a noop plan is left alone — that early return is correct for it', () => {
    // The flip side. `_applyData`'s noop skip is what stops the extended-hours
    // price-tag tick from wiping the developing bar every second; forcing setData
    // on everything would reintroduce that.
    binder.sync(ctxFor([inst('rsi')]))
    fake.reset()
    binder.sync(ctxFor([inst('rsi')], { plan: { noop: true } }))

    expect(fake.count('setData')).toBe(0)
    expect(fake.count('update')).toBe(0)
  })

  it('a surviving binding under an INCREMENTAL plan takes the update path', () => {
    binder.sync(ctxFor([inst('rsi')]))
    fake.reset()
    binder.sync(ctxFor([inst('rsi')], { plan: { incr: true } }))

    expect(fake.count('update')).toBe(1)
    expect(fake.count('setData')).toBe(0)
  })

  it('non-computable bars become LWC whitespace, never value: NaN', () => {
    // LWC rejects `value: NaN` outright. RSI is NaN-padded for its first
    // `period` bars, so the head of this array is the case.
    binder.sync(ctxFor([inst('rsi')]))
    const data = fake.callsOf('setData')[0].args[0]
    expect(data[0]).toEqual({ time: bars[0].t })
    expect(data.some(p => Number.isNaN(p.value))).toBe(false)
    expect(data[data.length - 1].value).toBeTypeOf('number')
  })
})

describe('reclaiming a pooled series drops the previous tenant\'s guides — trap #3', () => {
  it('calls removePriceLine for EVERY guide the previous tenant created', () => {
    // `createPriceLine` handles are never tracked in the shipped code, so
    // re-purposing a series would leave RSI's 70 / 50 / 30 drawn across an ATR.
    binder.sync(ctxFor([inst('rsi')]))
    const series = fake.seriesCreated[0]
    const created = fake.callsOf('createPriceLine')
    expect(created.map(c => c.args[0].price)).toEqual([70, 30, 50])
    expect(fake.livePriceLines(series)).toHaveLength(3)

    fake.reset()
    binder.sync(ctxFor([inst('atr')]))          // ATR declares no guides

    const removed = fake.callsOf('removePriceLine')
    expect(removed).toHaveLength(3)
    expect(new Set(removed.map(c => c.args[0]))).toEqual(new Set(created.map(c => c.result)))
    expect(fake.livePriceLines(series), 'no guide is left on the series').toEqual([])
    expect(fake.count('createPriceLine')).toBe(0)
    expect(fake.count('removeSeries')).toBe(0)
  })

  it('the NEW tenant\'s own guides are created after the old ones are removed', () => {
    binder.sync(ctxFor([inst('rsi')]))
    fake.reset()
    binder.sync(ctxFor([inst('mfi')]))          // MFI declares 80 / 20

    const removed = fake.callsOf('removePriceLine')
    const created = fake.callsOf('createPriceLine')
    expect(removed).toHaveLength(3)
    expect(created.map(c => c.args[0].price)).toEqual([80, 20])
    // Ordering is a real claim: creating first and removing afterwards would
    // delete the new tenant's guides if a handle were ever reused.
    expect(fake.calls.indexOf(removed[removed.length - 1])).toBeLessThan(fake.calls.indexOf(created[0]))
  })

  it('a SURVIVING binding with unchanged guides does not churn its price lines', () => {
    binder.sync(ctxFor([inst('rsi')]))
    fake.reset()
    binder.sync(ctxFor([inst('rsi')]))

    expect(fake.count('removePriceLine')).toBe(0)
    expect(fake.count('createPriceLine')).toBe(0)
  })

  it('a guide carries its declared colour, width and line style', () => {
    binder.sync(ctxFor([inst('rsi')]))
    const first = fake.callsOf('createPriceLine')[0].args[0]
    expect(first).toMatchObject({
      price: 70, color: 'rgba(123,104,238,0.4)', lineWidth: 1, axisLabelVisible: false,
    })
  })
})

describe('every bind re-asserts the FULL scale option set — trap #2', () => {
  it('the CREATE pass applies the complete object', () => {
    binder.sync(ctxFor([inst('rsi')]))
    const applied = fake.callsOf('priceScale.applyOptions')
    expect(applied).toHaveLength(1)
    expect(applied[0].args[0]).toEqual(RSI_SCALE)
  })

  it('the UPDATE pass applies the SAME complete object — not a subset', () => {
    // Today the fixed-range extras (`autoScale:false, minimum, maximum`) go on
    // the create branch only. Price scales are chart-level and keyed by id, so a
    // pooled series that inherited RSI's scale and never got its own asserted
    // would keep 0-100 and clip an ATR flat.
    binder.sync(ctxFor([inst('rsi')]))
    fake.reset()
    binder.sync(ctxFor([inst('rsi')]))

    const applied = fake.callsOf('priceScale.applyOptions')
    expect(applied).toHaveLength(1)
    expect(applied[0].args[0]).toEqual(RSI_SCALE)
  })

  it('a RE-PURPOSED series gets its NEW tenant\'s complete set, not the old one', () => {
    const atrScale = { borderVisible: false, scaleMargins: { top: 0.82, bottom: 0 }, autoScale: true }
    binder.sync(ctxFor([inst('rsi')]))
    fake.reset()
    binder.sync(ctxFor([inst('atr')], {
      placement: placementFake({ 'legacy:atr': { paneIndex: 0, scaleId: 'atr', scaleOptions: atrScale } }),
    }))

    const applied = fake.callsOf('priceScale.applyOptions')
    expect(applied).toHaveLength(1)
    expect(applied[0].args[0]).toEqual(atrScale)
    expect(applied[0].args[0].minimum, 'RSI\'s 0-100 must not linger').toBeUndefined()
  })

  it('the scale is applied on EVERY PASS — but ONCE per scale, not once per series', () => {
    // 🔴 THIS ASSERTED `2` — ONE WRITE PER BOUND SERIES — UNTIL B5 TASK 8
    // MEASURED THE SECOND WRITE AT 11,913 CHANGED PIXELS. `autoScale: false`
    // freezes the range at whatever the autoscale walk can see when it is
    // first materialised, and a second `priceScale().applyOptions` landing
    // BETWEEN two siblings' `setData` calls materialises it from the first
    // sibling alone. `adx`'s scale came out 15.5154..59.0249 (the ADX line's
    // own extent) where the shipped block gives 5.1746..59.0249 (all three).
    // The shipped blocks call `applyIndScale` ONCE; so does this now.
    //
    // ⛔ TRAP #2 IS UNCHANGED AND THAT IS THE POINT OF THE SECOND HALF: its
    // subject is a POOLED series inheriting a scale an earlier tenant left
    // frozen, which is a claim about every SYNC. Both passes still write.
    binder.sync(ctxFor([inst('stoch')]))
    expect(fake.count('priceScale.applyOptions'),
      'stoch binds TWO series on ONE scale — that is one write, not two').toBe(1)
    fake.reset()
    binder.sync(ctxFor([inst('stoch')]))
    expect(fake.count('priceScale.applyOptions'),
      'the second pass wrote nothing — TRAP #2 is about every SYNC').toBe(1)
  })

  it('…and TWO definitions on TWO scales still get TWO writes — it is per SCALE', () => {
    // The non-vacuity half: 'once' must not have become 'once per sync'.
    fake.reset()
    binder.sync(ctxFor([inst('stoch'), inst('rsi')]))
    const ids = fake.callsOf('addSeries').map((c) => c.args[1].priceScaleId)
    expect(new Set(ids).size, 'both definitions landed on one scale — vacuous').toBe(2)
    expect(fake.count('priceScale.applyOptions')).toBe(2)
  })
})

// ─── every bind re-asserts the FULL SERIES option set — the C-1/C-2/C-3 family ─
//
// The mirror of the block above, and the one that was missing. `applyOptions`
// MERGES, so a partial options object let a re-purposed series keep every option
// its previous tenant set and the new plot does not name. These three are the
// reviewer's own probes, kept verbatim as rails.

describe('a re-purposed series is left in the state a FRESH one would be in', () => {
  it('SAR → RSI: the point markers do not survive the re-purpose', () => {
    // SAR is a LineSeries with `lineWidth: 0` + point markers. RSI's line
    // declares neither, so before this every bar of the RSI line wore a dot.
    binder.sync(ctxFor([inst('sar')]))
    const series = fake.seriesCreated[0]
    expect(series.__options.pointMarkersVisible, 'the setup is vacuous without this').toBe(true)

    binder.sync(ctxFor([inst('rsi')]))
    expect(fake.count('addSeries'), 'it must be the SAME series — otherwise nothing was pooled').toBe(1)
    expect(series.__options.pointMarkersVisible).toBe(false)
    expect(series.__options.lineWidth).toBe(1)
  })

  it('Stochastic %D → ATR: the dashes do not survive it either', () => {
    // Two tenants on the way out and two on the way in, so BOTH Stochastic lines
    // are re-purposed rather than one of them being released — the pool is FIFO,
    // so %D lands on the second incoming binding.
    binder.sync(ctxFor([inst('stoch')]))
    const dSeries = fake.seriesCreated[1]                 // %K first, %D second
    expect(dSeries.__options.lineStyle, 'setup: %D ships dashed').toBe(2)

    binder.sync(ctxFor([inst('mfi'), inst('atr')]))       // neither declares a style
    expect(fake.count('addSeries'), 'both were pooled, nothing recreated').toBe(2)
    expect(dSeries.__options.lineStyle).toBe(0)           // LineStyle.Solid
  })

  it('a HIDDEN chart re-binds hidden — the toggle is not undone by the next paint', () => {
    // Alt+Shift+I applies `visible:false` to every engine series through the
    // binding map. `updateChart` runs again roughly once a second in extended
    // hours, and `visible` is part of the option set, so the value has to come
    // from the toggle rather than from LWC's default.
    binder.sync({ ...ctxFor([inst('rsi')]), indicatorsHidden: true })
    expect(fake.seriesCreated[0].__options.visible).toBe(false)

    binder.sync({ ...ctxFor([inst('rsi')]), indicatorsHidden: true })
    expect(fake.seriesCreated[0].__options.visible).toBe(false)

    binder.sync(ctxFor([inst('rsi')]))
    expect(fake.seriesCreated[0].__options.visible).toBe(true)
  })

  it('the pooled series ends up byte-identical to one created from scratch', () => {
    // The general statement of the three above: whatever the previous tenant was,
    // the re-purposed series' options must equal the options a brand-new series
    // for the same plot would have been born with.
    const fresh = createFakeChart()
    createBinder({ chart: fresh.chart, LWC: fresh.LWC }).sync(ctxFor([inst('rsi')]))
    const bornWith = fresh.callsOf('addSeries')[0].args[1]

    binder.sync(ctxFor([inst('sar')]))
    binder.sync(ctxFor([inst('rsi')]))

    expect(fake.count('addSeries')).toBe(1)
    expect(fake.seriesCreated[0].__options).toEqual(bornWith)
  })
})

describe('C-2 — a pooled PRICE OVERLAY does not keep the previous tenant\'s named scale', () => {
  // The REAL placement adapter, not the fake: the defect was in what placement
  // returned for a price target (`scaleId: null`) meeting how the pool read it
  // ("omit `priceScaleId`"). A fake that always returns a string cannot see it.
  //
  // ⭐ B5 TASK 12 PINNED THIS BLOCK TO `'bands'`, and the reason is in its own
  // title: a NAMED scale is what a `'bands'` oscillator has. Under `'panes'` the
  // previous tenant sits on its pane's `'right'` axis (sub-choice 2.2), which is
  // the same string the candles carry — so the setup line below would read
  // `'right'` before AND after and the case would pass while proving nothing.
  // The `'panes'` face of the same hazard is a PANE the pooled series must leave,
  // and that is the pane-move block above plus `flipCGeometry.test.jsx` on a real
  // renderer. Pinning keeps this one measuring the transition it was written for.
  beforeEach(pinBands)

  const realCtx = (instances) => ({
    ...ctxFor(instances),
    resolvePlacement: realPlacement,
    paneMargins: { rsi: { top: 0.85, bottom: 0 } },
    volOverlaySet: new Set(),
    volSeparatePane: false,
    VOL_PANE_INDEX: 1,
  })

  it('RSI off + BB on in ONE settings write — the exact B3 pilot transition', () => {
    binder.sync(realCtx([inst('rsi')]))
    const series = fake.seriesCreated[0]
    expect(series.__options.priceScaleId).toBe('rsi')

    binder.sync(realCtx([inst('bb')]))

    // Pooled, not recreated (that is the #2049 escape working) …
    expect(fake.count('removeSeries')).toBe(0)
    expect(fake.seriesCreated).toContain(series)
    // … and re-bound to the CANDLES' scale. Left on `rsi` it would inherit that
    // scale's `{autoScale:false, min:0, max:100}` and a $250 band would render
    // clipped off the top, invisible, with no error anywhere.
    for (const s of fake.seriesCreated) expect(s.__options.priceScaleId).toBe(MAIN_PRICE_SCALE_ID)
  })

  it('and asserts NOTHING on that scale — the candles own its margins', () => {
    binder.sync(realCtx([inst('bb')]))
    expect(fake.count('priceScale.applyOptions'), 'writing scaleMargins here moves the candles').toBe(0)
  })
})

describe('C-3 — MACD\'s histogram is coloured per bar, by sign', () => {
  it('emits StockChart\'s own green above zero and red below', () => {
    binder.sync(ctxFor([inst('macd')]))

    const hist = fake.callsOf('addSeries').find(c => c.args[0] === fake.LWC.HistogramSeries)
    expect(hist, 'no histogram was created — the rest of this test is vacuous').toBeTruthy()
    const points = fake.callsOf('setData').find(c => c.id === hist.result.__id).args[0]

    const drawn = points.filter(p => p.value !== undefined)
    expect(drawn.length).toBeGreaterThan(0)
    for (const p of drawn) {
      expect(p.color).toBe(p.value >= 0 ? 'rgba(76,175,80,0.75)' : 'rgba(244,67,54,0.75)')
    }
    // Both sides actually occur in this fixture — otherwise the loop above could
    // pass while only ever seeing one colour.
    expect(new Set(drawn.map(p => p.color)).size).toBe(2)
    // A whitespace point has no bar to colour.
    expect(points.filter(p => p.value === undefined).every(p => !('color' in p))).toBe(true)
  })

  it('a plot with no colorMode emits {time, value} and nothing else', () => {
    binder.sync(ctxFor([inst('rsi')]))
    const points = fake.callsOf('setData')[0].args[0]
    expect(points.every(p => !('color' in p))).toBe(true)
  })
})

describe('M-1 — a binding that cannot resolve gives its series BACK', () => {
  it('a placement that stops resolving releases the series it was carrying', () => {
    // Dropping it from `held` without `removeSeries` leaves it drawing the
    // previous tenant's numbers forever: the pool cannot see it and `teardown()`
    // cannot reach it. Unreachable with the native registry today; it is a Phase C
    // catalog definition away from being live, and it fails the wrong way.
    binder.sync(ctxFor([inst('rsi')]))
    const series = fake.seriesCreated[0]
    fake.reset()

    binder.sync(ctxFor([inst('rsi')], { placement: () => null }))

    expect(fake.count('removeSeries')).toBe(1)
    expect(fake.callsOf('removeSeries')[0].args[0]).toBe(series)
    expect(binder.bindings()).toHaveLength(0)
  })

  it('and a CREATE that cannot resolve removes nothing (there is nothing to give back)', () => {
    binder.sync(ctxFor([inst('rsi')], { placement: () => null }))
    expect(fake.count('removeSeries')).toBe(0)
    expect(fake.count('addSeries')).toBe(0)
  })
})

// ─── I-1: the compute and the point mapping are memoised ────────────────────
//
// `updateChart` re-runs ~1×/sec in extended hours and most of those passes are
// `noop`s whose work `_applyData` throws away. Unmemoised, 14 instances over
// 5,000 bars is 14 indicator computes and ~135,000 discarded point objects a
// second. Spec §5 states the budget ("columnar→object mapping reused, never
// re-allocated per update"); nothing in B2 owned it.
//
// The correctness half is the half that matters: a memo that serves stale numbers
// is worse than no memo at all, so every input it keys on has its own test.

/** The real registry, counting `computeFor`. One object, reused across syncs —
 *  the memo keys on registry identity, so a fresh wrapper per pass would make
 *  every "was it memoised" assertion vacuously false. */
const countingRegistry = () => {
  const computes = []
  return {
    computes,
    getDefinition: (id) => registry.getDefinition(id),
    listDefinitions: registry.listDefinitions,
    hasAnyFinite: registry.hasAnyFinite,
    computeFor: (def, b, inputs) => { computes.push(def.id); return registry.computeFor(def, b, inputs) },
  }
}

describe('compute and point-mapping memo', () => {
  it('computes ONCE across repeated passes with the same bars and inputs', () => {
    const reg = countingRegistry()
    const ctx = { ...ctxFor([inst('rsi'), inst('macd')]), registry: reg }
    binder.sync(ctx)
    expect(reg.computes.sort()).toEqual(['macd', 'rsi'])

    binder.sync(ctx)
    binder.sync({ ...ctx, plan: { noop: true } })
    binder.sync({ ...ctx, plan: { incr: true } })
    expect(reg.computes.sort(), 'the noop passes recomputed everything').toEqual(['macd', 'rsi'])
  })

  it('hands the renderer the SAME point array rather than a fresh one each pass', () => {
    const ctx = ctxFor([inst('rsi')])
    binder.sync(ctx)
    binder.sync(ctx)

    const setData = fake.callsOf('setData')
    expect(setData.length).toBe(2)        // create, then the surviving bind's applyData
    expect(setData[1].args[0]).toBe(setData[0].args[0])
  })

  it('RECOMPUTES when an input changes — the memo is on values, not on identity', () => {
    // `normalizeInstances` rebuilds `inputs` every read, so an identity check
    // would never hit and this memo would be decorative. The flip side is that it
    // must notice a real edit.
    const reg = countingRegistry()
    binder.sync({ ...ctxFor([inst('rsi', { inputs: { period: 14 } })]), registry: reg })
    const first = fake.callsOf('setData')[0].args[0].at(-1).value

    binder.sync({ ...ctxFor([inst('rsi', { inputs: { period: 30 } })]), registry: reg })
    expect(reg.computes).toEqual(['rsi', 'rsi'])
    const second = fake.callsOf('setData').at(-1).args[0].at(-1).value
    expect(second).not.toBe(first)
  })

  it('an equal-but-rebuilt inputs object does NOT recompute', () => {
    const reg = countingRegistry()
    binder.sync({ ...ctxFor([inst('rsi', { inputs: { period: 14, color: '#abcdef' } })]), registry: reg })
    binder.sync({ ...ctxFor([inst('rsi', { inputs: { color: '#abcdef', period: 14 } })]), registry: reg })
    expect(reg.computes, 'key order must not count as a change').toEqual(['rsi'])
  })

  it('RECOMPUTES when the bars change', () => {
    const reg = countingRegistry()
    binder.sync({ ...ctxFor([inst('rsi')]), registry: reg })
    binder.sync({ ...ctxFor([inst('rsi')]), registry: reg, bars: makeBars(300) })
    expect(reg.computes).toEqual(['rsi', 'rsi'])
    expect(fake.callsOf('setData').at(-1).args[0]).toHaveLength(300)
  })

  it('re-maps points when the plot\'s SIGN COLOURS change', () => {
    // The point array carries per-bar colours for a `colorMode: 'sign'` plot, so
    // the MAPPING depends on more than the column.
    //
    // ⚠️ THE FIRST VERSION OF THIS TEST WAS VACUOUS and a mutation said so:
    // deleting `up`/`down` from the point-memo key did not fail it, because
    // swapping the registry ALSO invalidated the compute memo, which handed back
    // a fresh column, which invalidated the point memo for a different reason.
    // So the column here is deliberately pinned: ONE object, returned by
    // reference from both registries, leaving the colours as the only thing that
    // can invalidate the mapping.
    const macdDef = registry.getDefinition('macd')
    const recoloured = {
      ...macdDef,
      plots: macdDef.plots.map(p => (p.key === 'histogram' ? { ...p, colorUp: '#00ff00', colorDown: '#ff0000' } : p)),
    }
    const cache = new Map()
    const stableCompute = (def, b, i) => {
      if (!cache.has(def.id)) cache.set(def.id, registry.computeFor(registry.getDefinition(def.id), b, i))
      return cache.get(def.id)
    }
    const regWith = (getDefinition) => ({
      getDefinition, listDefinitions: registry.listDefinitions,
      hasAnyFinite: registry.hasAnyFinite, computeFor: stableCompute,
    })
    // ONE `adjustTime` across both passes, for the same reason as the pinned
    // column: `ctxFor` builds a fresh arrow every call, and `adjustTime` is part
    // of the point memo's key (it stamps every `time`), so a per-pass one would
    // invalidate the mapping before the colours ever got a say.
    const stableAdjust = (t) => t

    binder.sync({ ...ctxFor([inst('macd')]), adjustTime: stableAdjust, registry: regWith((id) => registry.getDefinition(id)) })
    const before = new Set(fake.callsOf('setData').flatMap(c => c.args[0]).map(p => p.color).filter(Boolean))
    expect(before, 'setup: the first pass drew the shipped colours')
      .toEqual(new Set(['rgba(76,175,80,0.75)', 'rgba(244,67,54,0.75)']))

    binder.sync({
      ...ctxFor([inst('macd')]), adjustTime: stableAdjust,
      registry: regWith((id) => (id === 'macd' ? recoloured : registry.getDefinition(id))),
    })

    const drawn = fake.callsOf('setData').at(-1).args[0].filter(p => p.value !== undefined)
    expect(new Set(drawn.map(p => p.color))).toEqual(new Set(['#00ff00', '#ff0000']))
  })

  it('a DIFFERENT registry invalidates it — the compute function is part of the key', () => {
    const a = countingRegistry()
    const b = countingRegistry()
    binder.sync({ ...ctxFor([inst('rsi')]), registry: a })
    binder.sync({ ...ctxFor([inst('rsi')]), registry: b })
    expect(b.computes).toEqual(['rsi'])
  })

  it('prunes: an instance that goes away does not keep its arrays alive', () => {
    const reg = countingRegistry()
    binder.sync({ ...ctxFor([inst('rsi')]), registry: reg })
    binder.sync({ ...ctxFor([]), registry: reg })
    binder.sync({ ...ctxFor([inst('rsi')]), registry: reg })
    expect(reg.computes, 'a dropped instance must not stay memoised').toEqual(['rsi', 'rsi'])
  })

  it('teardown drops both memos', () => {
    const reg = countingRegistry()
    binder.sync({ ...ctxFor([inst('rsi')]), registry: reg })
    binder.teardown()
    binder.sync({ ...ctxFor([inst('rsi')]), registry: reg })
    expect(reg.computes).toEqual(['rsi', 'rsi'])
  })
})

describe('release and teardown', () => {
  it('a series nothing can reuse is removed', () => {
    binder.sync(ctxFor([inst('macd')]))          // 2 lines + 1 histogram
    expect(fake.count('addSeries')).toBe(3)
    fake.reset()

    binder.sync(ctxFor([inst('rsi')]))           // needs 1 line
    expect(fake.count('addSeries')).toBe(0)
    expect(fake.count('removeSeries')).toBe(2)   // the spare line and the histogram
  })

  it('teardown removes every bound series and then makes no further calls', () => {
    binder.sync(ctxFor([inst('macd')]))
    fake.reset()

    binder.teardown()
    expect(fake.count('removeSeries')).toBe(3)

    fake.reset()
    binder.teardown()
    expect(fake.calls).toEqual([])
  })

  it('after teardown a later sync starts clean rather than reusing dead handles', () => {
    binder.sync(ctxFor([inst('rsi')]))
    binder.teardown()
    fake.reset()

    binder.sync(ctxFor([inst('rsi')]))
    expect(fake.count('addSeries')).toBe(1)
  })

  it('a hidden instance releases its series', () => {
    binder.sync(ctxFor([inst('rsi')]))
    fake.reset()
    binder.sync(ctxFor([inst('rsi', { hidden: true })]))
    expect(fake.count('removeSeries')).toBe(1)
  })

  it('a hidden instance is not COMPUTED either — nobody was ever going to read it', () => {
    // `planBindings` drops a hidden instance on its first line, before it asks
    // `hasData`, so every compute done for one was thrown away — and it is a full
    // indicator pass over the whole bar set, on the main thread, inside
    // `updateChart`. B3's Flip-A visibility projection makes hidden the COMMON
    // state (every migrated indicator whose legacy toggle is off carries a hidden
    // instance), so this stopped being a rounding error.
    const reg = countingRegistry()
    binder.sync({ ...ctxFor([inst('rsi', { hidden: true }), inst('macd')]), registry: reg })
    expect(reg.computes, 'the hidden instance was computed for nothing').toEqual(['macd'])
  })

  it('…and unhiding it computes it again — the skip is not a poisoned memo', () => {
    const reg = countingRegistry()
    const hidden = { ...ctxFor([inst('rsi', { hidden: true })]), registry: reg }
    binder.sync(hidden)
    expect(reg.computes).toEqual([])
    binder.sync({ ...ctxFor([inst('rsi')]), registry: reg })
    expect(reg.computes, 'unhiding drew a line from a column nobody computed').toEqual(['rsi'])
    expect(fake.count('addSeries')).toBeGreaterThan(0)
  })
})

describe('it never takes the chart down', () => {
  it('a definition whose compute throws is skipped, not fatal', () => {
    const exploding = {
      getDefinition: (id) => registry.getDefinition(id),
      computeFor: () => { throw new Error('boom') },
      hasAnyFinite: registry.hasAnyFinite,
    }
    const ctx = { ...ctxFor([inst('rsi'), inst('atr')]), registry: exploding }

    expect(() => binder.sync(ctx)).not.toThrow()
    expect(fake.count('addSeries')).toBe(0)
  })

  it('a renderer call that throws does not abort the rest of the pass', () => {
    const bad = createFakeChart()
    let first = true
    const chart = {
      ...bad.chart,
      addSeries: (...args) => {
        if (first) { first = false; throw new Error('LWC exploded') }
        return bad.chart.addSeries(...args)
      },
    }
    const b2 = createBinder({ chart, LWC: bad.LWC })
    expect(() => b2.sync(ctxFor([inst('rsi'), inst('atr')]))).not.toThrow()
    expect(bad.count('addSeries')).toBe(1)       // the second one still bound
  })

  it('an all-NaN column binds nothing — hasAnyFinite, not .length', () => {
    // A 5-bar series cannot produce a 14-period RSI. Post-B1 the column is still
    // 5 long and full of NaN, so `.length` would create the series and the pane.
    binder.sync({ ...ctxFor([inst('rsi')]), bars: makeBars(5) })
    expect(fake.count('addSeries')).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B3 CARRY #1 — the autoscale seam, end to end
// ─────────────────────────────────────────────────────────────────────────────

describe('a re-purposed series is RESET, never left excluded (B3 carry #1)', () => {
  /**
   * LWC's own `merge`, reduced to the ONE behaviour this whole design turns on:
   * it SKIPS `undefined`, so `applyOptions({k: undefined})` cannot clear `k`.
   * Semantics taken from `lightweight-charts.development.mjs:184-200` and pinned
   * against the INSTALLED bundle in `pool.test.js` — this is a restatement for
   * readability, not a second source of truth.
   *
   * (`fakeChart`'s own `applyOptions` uses `Object.assign`, which COPIES
   * `undefined`. That difference is exactly what would hide this bug, so the
   * omission branch below is merged the library's way, not the double's.)
   */
  const lwcMerge = (dst, src) => {
    for (const k of Object.keys(src || {})) if (src[k] !== undefined) dst[k] = src[k]
    return dst
  }

  /** The layout the SHIPPED mode needs — one pane per pane-target instance. */
  const layoutFor = (instances) => computePaneLayout(instances, {
    chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
  })

  const autoscaleCtx = (instances) => ({
    enabled: true,
    registry,
    instances,
    bars,
    adjustTime: (t) => t,
    resolvePlacement: realPlacement,
    paneMargins: { rsi: { top: 0.85, bottom: 0 } },
    // ⭐ B5 TASK 12: this block runs in the SHIPPED mode rather than being pinned
    // back to `'bands'`, because which autoscale provider a target gets is the
    // same answer in both. What is NOT the same is that a `'panes'` oscillator
    // the layout gave no pane resolves to `null` and binds nothing — so without a
    // layout every case below would quietly lose its subject.
    paneLayout: layoutFor(instances),
    volOverlaySet: new Set(),
    volSeparatePane: false,
    VOL_PANE_INDEX: 1,
    plan: { fresh: true },
  })

  it('BB\'s series re-purposed as RSI gets the DEFAULT provider back', () => {
    binder.sync(autoscaleCtx([inst('bb')]))

    const excluded = fake.seriesCreated.filter(s => s.__options.autoscaleInfoProvider === AUTOSCALE_EXCLUDE)
    expect(excluded.length, 'BB drew nothing — the rest of this test is vacuous').toBe(3)
    // The state a re-purpose has to undo, captured BEFORE it happens.
    const tenant = { ...excluded[0].__options }

    fake.reset()
    binder.sync(autoscaleCtx([inst('rsi')]))

    // No series was created: the pool re-purposed one of BB's three.
    expect(fake.count('addSeries')).toBe(0)
    const applied = fake.callsOf('applyOptions').map(c => c.args[0])
    expect(applied.length).toBeGreaterThan(0)

    for (const opts of applied) {
      // A function, not undefined — LWC's merge skips undefined, so `undefined`
      // here would leave the Bollinger band's EXCLUDE in place and the RSI would
      // contribute nothing to its own 0-100 scale.
      expect(typeof opts.autoscaleInfoProvider).toBe('function')
      // …and the RIGHT function: calling it must return the base implementation's
      // answer, which `() => null` never does.
      const S = { priceRange: { minValue: 0, maxValue: 100 } }
      expect(opts.autoscaleInfoProvider(() => S)).toBe(S)
      expect(opts.autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)

      // ── AND THE OMISSION VARIANT DOES NOT RESTORE ──
      // Same merge, same previous tenant, this key dropped. That is what "reset
      // by omitting the option" would actually do to a pooled series.
      const omitted = { ...opts }
      delete omitted.autoscaleInfoProvider
      const viaOmission = lwcMerge({ ...tenant }, omitted)
      expect(
        viaOmission.autoscaleInfoProvider,
        'omitting the key leaves the previous tenant\'s provider — this is why DEFAULT is explicit',
      ).toBe(AUTOSCALE_EXCLUDE)
      expect(viaOmission.autoscaleInfoProvider(() => S)).toBeNull()

      // The explicit provider, merged the same way, actually restores.
      const viaIdentity = lwcMerge({ ...tenant }, opts)
      expect(viaIdentity.autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)
      expect(viaIdentity.autoscaleInfoProvider(() => S)).toBe(S)
    }
  })

  it('a price overlay is EXCLUDED and a pane oscillator is not — through the real placement', () => {
    // The seam's whole point, asserted at the renderer boundary rather than at
    // placement's: what reaches `addSeries` is what the chart actually gets.
    //
    // 🔴 B5 TASK 12: THIS WAS A MAP KEYED ON `priceScaleId` ALONE AND THAT STOPPED
    // IDENTIFYING ANYTHING. Sub-choice 2.2 puts an oscillator on its own pane's
    // `'right'` axis — the SAME STRING the candles' scale carries — so BB and RSI
    // collided on one key and the last write silently won. LWC keys a price scale
    // by (pane, id), and the partition below does too; it also says the quantities
    // out loud, so a collision cannot come back as a green test.
    //
    // ⛔ AND IT IS PHRASED AS *the candles' axis vs anywhere else*, WHICH IS THE
    // CLAIM AND IS TRUE IN BOTH MODES. `(0, 'right')` is where a price overlay
    // lands whatever `paneMode()` says — that branch is above the mode switch —
    // while the oscillator's own axis is `(0, 'rsi')` in bands and `(1, 'right')`
    // in panes. Naming either literal would have pinned this case to one mode for
    // no gain: `placement.test.js` owns which axis it is.
    binder.sync(autoscaleCtx([inst('bb'), inst('rsi')]))
    const onCandles = []
    const elsewhere = []
    for (const c of fake.callsOf('addSeries')) {
      const [, opts, paneIndex] = c.args
      const target = `${paneIndex}|${opts.priceScaleId}` === `0|${MAIN_PRICE_SCALE_ID}` ? onCandles : elsewhere
      target.push(opts.autoscaleInfoProvider)
    }
    // Non-vacuity, both halves: BB really did put three bands on the candles' axis
    // and RSI's line really is not one of them.
    expect(onCandles, 'BB drew nothing on the candles\' axis').toHaveLength(3)
    expect(elsewhere, 'RSI landed on the candles\' axis too — vacuous').toHaveLength(1)

    for (const p of onCandles) expect(p, 'BB must not stretch the candles').toBe(AUTOSCALE_EXCLUDE)
    for (const p of elsewhere) expect(p, 'RSI owns its own axis and must size it').toBe(AUTOSCALE_DEFAULT)
  })
})


// ─── FLIP C landed DARK at B5 Task 10 — and SHIPPED at Task 12 ──────────────
//
// The cutover shipped behind `paneMode()`, which is `'panes'` now. These two
// cases are the binder's half of "landed dark", and they describe the mode the
// flip REVERSES TO: with `'bands'` pinned, a `paneLayout` in the ctx must change
// nothing at all and the pane machinery must not be touched. That is still a live
// claim — reversal is one edit — and it is the control for the `'panes'` block
// below, which is why it is pinned rather than retired. The `'panes'` half is
// driven against a REAL lightweight-charts chart in
// `__tests__/flipCGeometry.test.jsx` — a double cannot say whether the renderer
// built the panes.

describe('FLIP C — a paneLayout in the ctx is INERT under bands', () => {
  // ⭐ B5 TASK 12 — the mode this block is ABOUT is no longer the default, so it
  // says which one it means. See `pinBands`.
  beforeEach(pinBands)

  const LAYOUT = computePaneLayout(
    [inst('rsi'), inst('macd')],
    { chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX },
  )

  it('the layout really does put them in panes 1 and 2 — so the case is not vacuous', () => {
    expect(LAYOUT.panes.map((p) => [p.key, p.index])).toEqual([['rsi', 1], ['macd', 2]])
  })

  const callsWith = (extra) => {
    const f = createFakeChart()
    createBinder({ chart: f.chart, LWC: f.LWC }).sync({
      ...ctxFor([inst('rsi'), inst('macd')]),
      resolvePlacement: realPlacement, paneMargins: {}, ...extra,
    })
    return f.calls.map((c) => `${c.method}|${JSON.stringify(c.args)}`)
  }

  it('makes exactly the same calls, in the same order, with and without it', () => {
    const without = callsWith({})
    const withLayout = callsWith({ paneLayout: LAYOUT })
    expect(withLayout).toEqual(without)
    expect(without.length).toBeGreaterThan(3)   // non-vacuity: it really bound things
  })

  it('never asks the chart for its panes, so the dark contract survives Flip C', () => {
    let asked = 0
    fake.chart.panes = () => { asked++; return [] }
    binder.sync({
      ...ctxFor([inst('rsi')]),
      resolvePlacement: realPlacement, paneMargins: {}, paneLayout: LAYOUT,
    })
    expect(asked).toBe(0)
    // …and the control: under `'panes'` it DOES ask, so the zero above is a
    // statement about the mode and not about a call that never existed.
    __setPaneModeForTest('panes')
    try {
      const fake2 = createFakeChart()
      let asked2 = 0
      fake2.chart.panes = () => { asked2++; return [] }
      createBinder({ chart: fake2.chart, LWC: fake2.LWC }).sync({
        ...ctxFor([inst('rsi')]),
        resolvePlacement: realPlacement, paneMargins: {}, paneLayout: LAYOUT,
      })
      expect(asked2).toBeGreaterThan(0)
    } finally { pinBands() }   // ⭐ B5 TASK 12 — back to the mode this block pins.
  })
})

describe('FLIP C — the stretch factors are the pixel heights (PANE_MODE panes)', () => {
  const LAYOUT = computePaneLayout(
    [inst('rsi'), inst('macd')],
    { chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX },
  )

  it('writes one setStretchFactor per pane, with the layout s own numbers', () => {
    __setPaneModeForTest('panes')
    try {
      const written = []
      const pane = (i) => ({
        getHeight: () => 0,
        getStretchFactor: () => 1,
        setStretchFactor: (v) => written.push([i, v]),
      })
      fake.chart.panes = () => [pane(0), pane(1), pane(2)]
      binder.sync({
        ...ctxFor([inst('rsi'), inst('macd')]),
        resolvePlacement: realPlacement, paneMargins: {}, paneLayout: LAYOUT,
      })
      expect(written).toEqual([
        [0, LAYOUT.pane0.stretchFactor],
        [1, LAYOUT.panes[0].stretchFactor],
        [2, LAYOUT.panes[1].stretchFactor],
      ])
      // The whole stack still adds up to the chart, separators included.
      expect(written.reduce((s, [, v]) => s + v, 0) + 2 * SEPARATOR_PX).toBe(600)
    } finally { __setPaneModeForTest(null) }
  })

  it('writes NOTHING when every pane already holds the factor it wants', () => {
    __setPaneModeForTest('panes')
    try {
      const want = [LAYOUT.pane0.stretchFactor, LAYOUT.panes[0].stretchFactor, LAYOUT.panes[1].stretchFactor]
      const written = []
      fake.chart.panes = () => want.map((v, i) => ({
        getHeight: () => v,
        getStretchFactor: () => v,
        setStretchFactor: (x) => written.push([i, x]),
      }))
      binder.sync({
        ...ctxFor([inst('rsi'), inst('macd')]),
        resolvePlacement: realPlacement, paneMargins: {}, paneLayout: LAYOUT,
      })
      expect(written).toEqual([])
    } finally { __setPaneModeForTest(null) }
  })
})
