// app/src/components/chart/engine/__tests__/autoscaleOnARealScale.test.js
//
// ─── THE PROVIDER IS NOT INERT ON A FIXED-RANGE PANE ────────────────────────
//
// This file exists because the opposite was written into `placement.js` as the
// JUSTIFICATION for a design decision, in four places, and it is false:
//
//     "autoScale: false above already pins 0-100, which makes the provider
//      inert rather than wrong"
//
// ⛔ `minimum` and `maximum` ARE NOT lightweight-charts 5.2.0 PRICE-SCALE
// OPTIONS. The full `PriceScaleOptions` member list (`dist/typings.d.ts:3706+`)
// is autoScale · mode · invertScale · alignLabels · scaleMargins · borderVisible
// · borderColor · textColor · entireTextOnly · visible · ticksVisible ·
// minimumWidth · ensureEdgeTickMarksVisible. `applyOptions` funnels through
// `merge`, which copies the two unknown keys into the options bag verbatim — a
// `priceScale().options()` readback really does show `minimum: 0, maximum: 100`
// sitting there — and NOTHING in the library ever reads them. So they pin
// nothing, and `applyIndScale`'s `bandExtra` (`StockChart.jsx:5546-5554`, passed
// at `:5968`, `:6001`, …) has been handing the renderer two non-options since it
// was written. That is pre-existing and parity-NEUTRAL — the engine passes the
// same non-options the legacy block does, so both sides are equally inert — but
// it means no fixed-range definition is actually range-pinned by anything.
//
// What `autoScale: false` really does is stop `_internal_recalculatePriceScale`
// from re-invalidating the range on the routine model update (`:5455-5459`); the
// range itself still comes from the AUTOSCALE WALK, which merges every source's
// `_internal_autoscaleInfo()` (`:5089-5127`). That walk is exactly what
// `autoscaleInfoProvider` intercepts. So on RSI's own band the provider is
// DECISIVE, and the numbers below are the proof.
//
// ─── WHY A REAL CHART AND NOT A DOUBLE ──────────────────────────────────────
//
// A recording double cannot answer "what range does the scale end up with" —
// that is the library's arithmetic, and the library is the thing whose behaviour
// was mis-stated. So this drives the REAL `lightweight-charts` in the exact call
// order both `StockChart`'s create branch (`:5960-5972`) and `binder.js`'s create
// branch use: candles first and setData'd, then addSeries with the series
// options, then the price-scale options, then the indicator's own setData.
//
// ⚠️ THE ORDER IS LOAD-BEARING AND WAS MEASURED. With NO candle series (an empty
// time scale) every variant below comes back `range: null`, because
// `_private__insertDataSource`'s recalculate is skipped while the time scale is
// empty and the later one early-returns on `autoScale: false`. That regime makes
// the provider look inert — which is very likely how the false claim was arrived
// at in the first place. Production always has candles, so `productionOrder`
// below is the regime that ships.
//
// The options handed to the series are NOT hand-written here: they come from the
// real `resolvePlacement` + `seriesOptionsForPlot` for the real `rsi` definition.
// That is what makes this a gate on OUR code and not just a library demo — flip
// placement's pane branch to 'exclude', or break either provider singleton, and
// the numbers below move by ~2,000 pixels.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createChart, LineSeries, CandlestickSeries } from 'lightweight-charts'
import { resolvePlacement } from '../placement'
import { seriesOptionsForPlot, AUTOSCALE_EXCLUDE, AUTOSCALE_DEFAULT } from '../pool'
import { __setPaneModeForTest } from '../paneLayout'
import * as engineRegistry from '../nativeRegistry'

// ─── jsdom needs a 2D context and a non-zero layout ──────────────────────────
//
// File-scoped: vitest gives every test file its own jsdom, so these patches
// cannot reach another suite. Nothing here draws — the assertions are all on the
// price scale's arithmetic, which needs a height, not a canvas.
// ⭐ B5 TASK 12 — THIS FILE MEASURES THE GEOMETRY THE FLIP REVERSES TO.
//
// `PANE_MODE` is `'panes'` since Task 12. Every case below drives
// `resolvePlacement` through `CTX`, which carries a `paneMargins` map and no
// `paneLayout` — a BANDS context, by construction: `CTX.paneMargins.rsi` is the
// `{top: 0.82, bottom: 0}` band whose height is the whole subject of the
// `priceToCoordinate` numbers. Under the unpinned default that same call takes
// the PANES branch, finds no layout to name a pane in, and correctly returns
// `null` (fail-closed), which is what made these four cases throw rather than
// disagree. So the MODE is pinned and the expectations are untouched — bands is
// still a live, tested mode and these are its numbers.
//
// ⚠️ WHAT THIS FILE THEREFORE DOES NOT COVER: the PANES branch's own
// `autoscale: 'default'` (`placement.js:405`). It is the same answer for the
// same reason, and `placement.js` says so in place, but nothing here measures it
// on a real scale. That is a coverage gap worth a follow-up, not a defect.
beforeAll(() => { __setPaneModeForTest('bands') })
afterAll(() => { __setPaneModeForTest(null) })

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 800, height: 400 }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 800 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 400 }, configurable: true })
})

const T = (i) => 1_700_000_000 + i * 86_400
const CANDLES = Array.from({ length: 120 }, (_, i) => ({ time: T(i), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }))
/** A deterministic RSI-shaped column: a sine wave inside 30..70. Its exact
 *  extent is what the scale should end up showing when nothing blocks it. */
const RSI_VALUES = Array.from({ length: 120 }, (_, i) => ({ time: T(i), value: 50 + 20 * Math.sin(i / 6) }))

const RSI_DEF = engineRegistry.getDefinition('rsi')
const RSI_PLOT = RSI_DEF.plots.find(p => p.key === 'rsi')
const CTX = { paneMargins: { rsi: { top: 0.82, bottom: 0 } }, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1 }

/** The placement the engine actually resolves for a pane-target RSI. */
const rsiPlacement = () => resolvePlacement({ instanceId: 'legacy:rsi', defId: 'rsi' }, RSI_DEF, CTX)

/**
 * Build a chart in production's call order and return the indicator series.
 *
 * @param seriesOptions the FULL series option set (the pool's output, or a
 *        control with the provider key removed entirely).
 */
function productionOrder(seriesOptions, scaleOptions) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const chart = createChart(el, { width: 800, height: 400 })

  // 1. The candles, with data. Without this the time scale is empty and every
  //    variant reads back `null` — see the header.
  chart.addSeries(CandlestickSeries, {}).setData(CANDLES)
  chart.timeScale().setVisibleLogicalRange({ from: 0, to: CANDLES.length - 1 })

  // 2. addSeries → priceScale().applyOptions → setData, exactly as shipped.
  const s = chart.addSeries(LineSeries, seriesOptions)
  s.priceScale().applyOptions(scaleOptions)
  s.setData(RSI_VALUES)
  return s
}

/** The observable: what range did the scale settle on, and where does a price
 *  inside the band actually land? */
const read = (s) => ({
  range: s.priceScale().getVisibleRange(),
  c30: s.priceToCoordinate(30),
  c69: s.priceToCoordinate(69),
})

/** The engine's own answer for RSI, end to end. */
function engineRsi(autoscaleOverride) {
  const p = rsiPlacement()
  const options = seriesOptionsForPlot(RSI_PLOT, {
    scaleId: p.scaleId,
    autoscale: autoscaleOverride === undefined ? p.autoscale : autoscaleOverride,
  })
  return { series: productionOrder(options, p.scaleOptions), options, placement: p }
}

describe('autoscaleInfoProvider on a REAL fixed-range price scale (B3 carry #1, fix round 1)', () => {
  it('minimum/maximum reach the options bag and pin NOTHING', () => {
    const { series, placement } = engineRsi()

    // Placement really does emit them — this is not a strawman.
    expect(placement.scaleOptions).toMatchObject({ autoScale: false, minimum: 0, maximum: 100 })
    const live = series.priceScale().options()
    expect(live.minimum, 'merge() copied the unknown key in').toBe(0)
    expect(live.maximum).toBe(100)
    expect(live.autoScale).toBe(false)

    // …and the scale is NOT 0-100. It is the RSI COLUMN's own extent, because
    // the range came from the autoscale walk over the series, not from those two
    // keys. If lightweight-charts ever starts honouring them, this flips and the
    // comments that depend on it need re-reading.
    const { from, to } = series.priceScale().getVisibleRange()
    expect(from).toBeGreaterThan(29); expect(from).toBeLessThan(31)
    expect(to).toBeGreaterThan(69); expect(to).toBeLessThan(71)
    expect(from === 0 && to === 100, 'the scale is NOT pinned to 0-100').toBe(false)
  })

  it('EXCLUDE is not inert on RSI — it collapses the band and throws the line off-pane', () => {
    // The control: what the shipped legacy block does — no provider at all.
    const bare = { ...engineRsi().options }
    delete bare.autoscaleInfoProvider
    const control = read(productionOrder(bare, rsiPlacement().scaleOptions))

    // The engine's real answer for a PANE definition.
    const asShipped = read(engineRsi().series)

    // The wrong answer: a price overlay's provider on an oscillator's own band.
    const excluded = read(engineRsi('exclude').series)

    // The control is sane — otherwise everything below compares two broken things.
    expect(control.range).not.toBeNull()
    expect(control.c30).toBeGreaterThan(0)

    // ⛔ THE MEASUREMENT. `() => null` leaves the scale with no contributing
    // source, so `_private__recalculatePriceRangeImpl` falls through to its
    // "reset empty to default" branch (`:5169-5171`) and the band becomes
    // -0.5..0.5. A price of 30 then maps ~2,000px above the pane.
    expect(excluded.range).toEqual({ from: -0.5, to: 0.5 })
    expect(excluded.c30).toBeLessThan(0)
    expect(Math.abs(excluded.c30 - control.c30), 'the provider moved the line by ~2000px').toBeGreaterThan(1000)

    // …and the shipped answer is the control's, exactly.
    expect(asShipped.range).toEqual(control.range)
    expect(asShipped.c30).toBe(control.c30)
  })

  it('AUTOSCALE_DEFAULT is byte-identical to no provider at all', () => {
    const withDefault = { ...engineRsi().options }
    expect(withDefault.autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)
    const bare = { ...withDefault }
    delete bare.autoscaleInfoProvider

    const a = read(productionOrder(withDefault, rsiPlacement().scaleOptions))
    const b = read(productionOrder(bare, rsiPlacement().scaleOptions))

    // Not "close" — the SAME float. This is the identity-provider claim measured
    // on a real chart rather than argued from the bundle source.
    expect(a.range).toEqual(b.range)
    expect(a.c30).toBe(b.c30)
    expect(a.c69).toBe(b.c69)
    expect(Number.isFinite(a.c30) && a.c30 > 0, 'a degenerate control would make the equality meaningless').toBe(true)
  })

  it('AUTOSCALE_EXCLUDE is what the price overlays need — proven on the candles\' own scale', () => {
    // The other half of the seam: a guest on the candles' axis must contribute
    // nothing to it. Same real chart, one candle series + one line series far
    // above it, bound to the SAME (default) price scale.
    const build = ({ overlay, provider }) => {
      const el = document.createElement('div'); document.body.appendChild(el)
      const chart = createChart(el, { width: 800, height: 400 })
      const c = chart.addSeries(CandlestickSeries, {})
      c.setData(CANDLES)
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: CANDLES.length - 1 })
      if (overlay) {
        const opts = { priceScaleId: 'right', lineWidth: 1 }
        if (provider) opts.autoscaleInfoProvider = provider
        // A band running FAR off the top — the case the shipped overlays exist
        // to stop from reframing the candles.
        chart.addSeries(LineSeries, opts).setData(CANDLES.map(b => ({ time: b.time, value: b.close * 5 })))
      }
      return c.priceScale().getVisibleRange()
    }

    // The reference: what the candles look like with NO overlay on their axis.
    const candlesAlone = build({ overlay: false })
    const guest = build({ overlay: true, provider: AUTOSCALE_EXCLUDE })
    const shouter = build({ overlay: true, provider: AUTOSCALE_DEFAULT })

    expect(guest, 'EXCLUDE must leave the candles framed exactly as if the overlay were absent').toEqual(candlesAlone)
    // The control that stops the line above passing vacuously: an overlay that
    // DOES contribute really does reframe the candles, so "unchanged" is a
    // result and not the only thing that could have happened.
    expect(shouter.to, 'a DEFAULT overlay really would stretch the candles').toBeGreaterThan(candlesAlone.to * 2)
  })

  it('every definition resolves to a mode the pool can map — AUTOSCALE_MODES has a consumer', () => {
    for (const def of engineRegistry.listDefinitions()) {
      const p = resolvePlacement({ instanceId: `i:${def.id}`, defId: def.id }, def, CTX)
      const emitted = seriesOptionsForPlot(
        def.plots.find(pl => pl.style !== 'hlines'),
        { scaleId: p.scaleId, autoscale: p.autoscale },
      ).autoscaleInfoProvider
      expect([AUTOSCALE_EXCLUDE, AUTOSCALE_DEFAULT], def.id).toContain(emitted)
      expect(
        emitted === (p.autoscale === 'exclude' ? AUTOSCALE_EXCLUDE : AUTOSCALE_DEFAULT),
        `${def.id}: pool disagreed with placement`,
      ).toBe(true)
    }
  })
})
