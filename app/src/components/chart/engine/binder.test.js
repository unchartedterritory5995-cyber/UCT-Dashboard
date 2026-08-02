import { describe, it, expect, beforeEach } from 'vitest'
import { createBinder } from './binder'
import { resolvePlacement as realPlacement, MAIN_PRICE_SCALE_ID } from './placement'
import { createFakeChart, makeBars } from './__tests__/fakeChart'
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

  it('the scale is applied on EVERY pass, for every bound series', () => {
    binder.sync(ctxFor([inst('stoch')]))
    expect(fake.count('priceScale.applyOptions')).toBe(2)
    fake.reset()
    binder.sync(ctxFor([inst('stoch')]))
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
