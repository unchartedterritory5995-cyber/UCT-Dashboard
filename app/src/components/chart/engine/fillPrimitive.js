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
export function fillRuns(upper, lower) {
  // ⛔⛔ NOT `Array.isArray`. THIS ENGINE'S COLUMNS ARE TYPED ARRAYS.
  // ⚰️ MEASURED ON THE LIVE CHART: `up=600/581 lo=600/581 … runs=0`. Both columns
  // held 581 finite values, every coordinate resolved, the fill style was valid —
  // and `Array.isArray(Float64Array)` is FALSE, so the length collapsed to 0 and
  // the band drew nothing. Sixteen green unit tests never saw it because they all
  // pass plain arrays; only an A/B pixel diff on the real chart did.
  // A length check accepts both, which is what "a column" has always meant here.
  const len = (a) => (a && typeof a.length === 'number' ? a.length : 0)
  const n = Math.min(len(upper), len(lower))
  const runs = []
  let start = -1
  for (let i = 0; i < n; i += 1) {
    const ok = Number.isFinite(upper[i]) && Number.isFinite(lower[i])
    if (ok && start < 0) start = i
    else if (!ok && start >= 0) { runs.push({ from: start, to: i - 1 }); start = -1 }
  }
  if (start >= 0) runs.push({ from: start, to: n - 1 })
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
export function fillPolygons({ upper, lower, times, timeToX, priceToY }) {
  return fillRuns(upper, lower)
    .flatMap((run) => runPolygon(run, upper, lower, times, timeToX, priceToY))
    .filter((poly) => poly.length >= 4)
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
        const { upper, lower, times } = opts
        if (!upper || !lower || !times) return
        const ts = chart.timeScale()
        const timeToX = (t) => { try { return ts.timeToCoordinate(t) } catch { return null } }
        const priceToY = (p) => { try { return series.priceToCoordinate(p) } catch { return null } }
        const polys = fillPolygons({ upper, lower, times, timeToX, priceToY })
        if (!polys.length) return
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          ctx.save()
          ctx.fillStyle = withAlpha(opts.color, opts.opacity) || opts.color
          for (const poly of polys) {
            ctx.beginPath()
            ctx.moveTo(poly[0].x, poly[0].y)
            for (let i = 1; i < poly.length; i += 1) ctx.lineTo(poly[i].x, poly[i].y)
            ctx.closePath()
            ctx.fill()
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
