// app/src/components/chart/engine/fillPrimitive.js
//
// ─── ⭐⭐ C1-B: THE AREA BETWEEN TWO PLOTS ───────────────────────────────────
//
// `fill(plotA, plotB, color)` is Pine's band idiom and it is not a niche one:
// measured over the frozen 60-script out-of-sample corpus, **35 fill() calls
// across 18 scripts, and 33 of the 35 are plot↔plot**. Exactly one is
// hline↔hline.
//
// ⛔ THAT MEASUREMENT DECIDED THE IMPLEMENTATION. Lightweight-charts can fill a
// series to a fixed price natively (`BaselineSeries`), and building only that
// would have been a fraction of the work — and would have served ONE of the
// thirty-five. A capability built for a demand that is not there is worse than
// none: it reads as support in every summary.
//
// ─── THE SHAPE: A PURE CORE AND A THIN SHELL ────────────────────────────────
//
// ⛔ CANVAS CODE CANNOT BE UNIT-TESTED, so as little as possible of this is
// canvas code. `fillRuns` is a pure function over two columns and answers the
// whole question — WHICH spans get filled, and where each one starts and stops.
// The primitive's `draw` is a dumb consumer of that answer. Every rule worth
// getting right (a gap must not be bridged; one missing value ends a span; a
// single isolated point is not an area) lives in the pure half and is tested
// there. That is the same split `binder.js` states for itself.
//
// ⛔ AND A GAP IS NEVER BRIDGED. Two plots that both go `na` for a week and come
// back must show a HOLE, not a straight band across the hole. A fill that spans
// missing data invents a relationship the indicator never asserted, and it is
// invisible as a bug — it looks like a band.

import { withAlpha } from '../designTokens'

/**
 * The contiguous spans in which BOTH columns hold a finite value.
 *
 * @param {number[]} upper
 * @param {number[]} lower
 * @returns {Array<{from: number, to: number}>} inclusive index ranges, in order
 *
 * ⛔ A RUN OF LENGTH 1 IS STILL RETURNED. One bar where both series exist is a
 * real, if thin, area — dropping it would silently erase a single-bar band, and
 * "too small to matter" is a judgement the renderer is not entitled to make.
 * The DRAW step decides what a one-bar span looks like in pixels.
 */
export function fillRuns(upper, lower, colors) {
  // ⛔⛔ NOT `Array.isArray`. THIS ENGINE'S COLUMNS ARE TYPED ARRAYS.
  // ⚰️ MEASURED ON THE LIVE CHART: `up=600/581 lo=600/581 … runs=0`. Both columns
  // held 581 finite values, every coordinate resolved, the fill style was valid —
  // and `Array.isArray(Float64Array)` is FALSE, so the length collapsed to 0 and
  // the band drew nothing. Sixteen green unit tests never saw it because they all
  // pass plain arrays; only an A/B pixel diff on the real chart did.
  // A length check accepts both, which is what "a column" has always meant here.
  const len = (a) => (a && typeof a.length === 'number' ? a.length : 0)
  const n = Math.min(len(upper), len(lower))
  // ⭐⭐ R30 — A RUN ALSO ENDS WHERE THE COLOUR CHANGES, AND `null` ENDS ONE
  // WITHOUT STARTING ANOTHER. `colors` is the per-point array
  // `columnColorsForPlot` yields for the fill exactly as for a plot; a `null`
  // entry is an `na` condition (or a dynamic transparency), and R30 rules that
  // such a bar is a GAP, never a guess — the same answer `toPoints` already gives
  // a plot, where a non-finite condition gets no colour rather than the "false"
  // one. Picking a side here would paint every warm-up bar the down colour, which
  // reads as a real signal for as many bars as the condition's own lookback.
  //
  // ⛔ NO `colors` ⇒ IDENTICAL BEHAVIOUR, BY CONSTRUCTION. `dyn` is false, the
  // colour comparison never runs, and `color` stays `undefined` — so a static
  // fill segments exactly as it always has and its draw calls cannot move.
  const dyn = len(colors) > 0
  const colourAt = (i) => (dyn ? (colors[i] == null ? null : colors[i]) : undefined)
  const runs = []
  let start = -1
  let runColour
  for (let i = 0; i < n; i += 1) {
    const c = colourAt(i)
    const ok = Number.isFinite(upper[i]) && Number.isFinite(lower[i]) && c !== null
    if (!ok) {
      if (start >= 0) { runs.push({ from: start, to: i - 1, color: runColour }); start = -1 }
      continue
    }
    if (start < 0) { start = i; runColour = c; continue }
    if (dyn && c !== runColour) {
      runs.push({ from: start, to: i - 1, color: runColour })
      start = i
      runColour = c
    }
  }
  if (start >= 0) runs.push({ from: start, to: n - 1, color: runColour })
  return runs
}

/**
 * One run → the polygon that fills it, in screen coordinates.
 *
 * Walks the upper edge left→right and the lower edge right→left, which is the
 * only ordering that produces a simple (non-self-intersecting) polygon when the
 * two series CROSS — and they do: a band whose edges swap places is exactly what
 * a Bollinger squeeze or a two-MA ribbon looks like at a crossover.
 *
 * ⛔⛔ A POINT WHOSE COORDINATE CANNOT BE RESOLVED **SPLITS** THE RUN — it neither
 * ends it nor is stitched across.
 *
 * ⚰️ THE FIRST VERSION `break`-ED ON THE FIRST NULL, and the reasoning was sound
 * for an INTERIOR null (stitching would drag the band's edge to whatever the next
 * resolvable bar happens to be, drawing a wedge that is not in the data) — but it
 * was wrong about WHERE nulls occur. `timeToCoordinate` answers null for every bar
 * outside the VISIBLE RANGE, and a chart holds 5,000 bars while showing ~200: the
 * FIRST bar is essentially always off-screen. So the very first point broke the
 * loop and every polygon came back empty. Fifteen green unit tests and a live
 * `attach ok=true`, and the band drew nothing at all — caught only by an A/B
 * pixel diff against the same definition with the fill removed.
 *
 * Splitting satisfies both: the off-screen head and tail contribute nothing, and
 * a genuine interior gap still yields two polygons rather than one bridging it.
 *
 * @returns {Array<Array<{x:number,y:number}>>} zero or more polygons.
 */
export function runPolygon(run, upper, lower, times, timeToX, priceToY) {
  const out = []
  let top = []
  let bottom = []
  const flush = () => {
    if (top.length === 0) { bottom = []; return }
    if (top.length === 1) {
      // A single bar has no width of its own; give it the thinnest honest area so
      // a one-bar band is visible at all rather than silently absent.
      const { x } = top[0]
      out.push([
        { x: x - 0.5, y: top[0].y }, { x: x + 0.5, y: top[0].y },
        { x: x + 0.5, y: bottom[0].y }, { x: x - 0.5, y: bottom[0].y },
      ])
    } else {
      out.push([...top, ...bottom.reverse()])
    }
    top = []
    bottom = []
  }
  for (let i = run.from; i <= run.to; i += 1) {
    const x = timeToX(times[i])
    const yU = priceToY(upper[i])
    const yL = priceToY(lower[i])
    if (x == null || yU == null || yL == null) { flush(); continue }
    top.push({ x, y: yU })
    bottom.push({ x, y: yL })
  }
  flush()
  return out
}

/**
 * Every polygon a fill draws this frame.
 *
 * ⭐ THE WHOLE GEOMETRY, PURE. A test can hand this two columns and two trivial
 * coordinate functions and assert the exact shapes — including that a gap
 * produces TWO polygons rather than one.
 */
export function fillGroups({ upper, lower, times, colors, timeToX, priceToY }) {
  return fillRuns(upper, lower, colors)
    .map((run) => ({
      color: run.color,
      polys: runPolygon(run, upper, lower, times, timeToX, priceToY)
        .filter((poly) => poly.length >= 4),
    }))
    .filter((group) => group.polys.length > 0)
}

/**
 * Every polygon a fill draws this frame, flattened.
 *
 * ⛔ DELEGATES TO `fillGroups` RATHER THAN REPEATING IT. Two functions walking
 * the same runs is two authorities on one geometry, and the moment one gains a
 * rule the other lacks the band drawn and the band tested stop being the same
 * shape. This is the flattening of the answer, not a second answer.
 */
export function fillPolygons(args) {
  return fillGroups(args).flatMap((group) => group.polys)
}

/**
 * A lightweight-charts series primitive that fills between its host series'
 * column and a second one.
 *
 * Follows `sessionShadingPrimitive`'s shape exactly — same `paneViews`/
 * `attached`/`detached` contract, same `setOptions` + `requestUpdate` idiom — so
 * there is one way primitives are written in this codebase, not two.
 *
 * opts: `{ upper, lower, times, color, opacity }`
 */
export function createFillPrimitive(initial) {
  let opts = { upper: null, lower: null, times: null, color: '#2962FF', opacity: 0.15, ...initial }
  let series = null
  let chart = null
  let requestUpdate = null

  const paneView = {
    // ⛔ BELOW THE LINES IT SITS BETWEEN. A band painted over its own edges hides
    // them, and the edges are the indicator; the fill is the annotation.
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!series || !chart) return
        const { upper, lower, times, colors } = opts
        if (!upper || !lower || !times) return
        const ts = chart.timeScale()
        const timeToX = (t) => { try { return ts.timeToCoordinate(t) } catch { return null } }
        const priceToY = (p) => { try { return series.priceToCoordinate(p) } catch { return null } }
        const groups = fillGroups({ upper, lower, times, colors, timeToX, priceToY })
        if (!groups.length) return
        // ⭐⭐ R30 — ONE `fillStyle` PER RUN when the fill is colour-driven, and ONE
        // FOR THE WHOLE FRAME when it is not.
        //
        // ⛔ THE STATIC CASE IS NOT A SECOND PATH, IT IS THE DEGENERATE ONE, and it
        // is written this way on purpose: a single-colour band is ONE run however
        // many polygons an `na` hole splits it into, so its call list is what it
        // has always been. Setting the style per GEOMETRY run instead would make a
        // shipped band with a gap start assigning `fillStyle` three times — a
        // change to the drawing of every fill nobody made dynamic.
        //
        // ⛔ AND THE RUN COLOUR IS USED VERBATIM — no `withAlpha` here. The two
        // colours arrive from `columnColorsForPlot`, which has ALREADY applied the
        // fill's alpha through `twoColoursOf`; applying `opts.opacity` on top would
        // dim them a second time and be a second authority over one value.
        const dynamic = !!(colors && colors.length)
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          ctx.save()
          if (!dynamic) ctx.fillStyle = withAlpha(opts.color, opts.opacity) || opts.color
          for (const group of groups) {
            if (dynamic) ctx.fillStyle = group.color
            for (const poly of group.polys) {
              ctx.beginPath()
              ctx.moveTo(poly[0].x, poly[0].y)
              for (let i = 1; i < poly.length; i += 1) ctx.lineTo(poly[i].x, poly[i].y)
              ctx.closePath()
              ctx.fill()
            }
          }
          ctx.restore()
        })
      },
    }),
  }

  const primitive = {
    paneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (param) => {
      series = param.series || null
      chart = param.chart || null
      requestUpdate = param.requestUpdate || null
    },
    detached: () => { series = null; chart = null; requestUpdate = null },
  }

  return {
    primitive,
    setOptions(patch) { opts = { ...opts, ...patch }; if (requestUpdate) requestUpdate() },
  }
}
