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
 * ⭐⭐ W19-R2 — A GRADIENT BAND, ONE QUAD PER BAR STEP (Pine's `fill(p1, p2,
 * top_value, bottom_value, top_color, bottom_color)`, Q-RT15d).
 *
 * CAP5 settled the shading: linear in PRICE from the top colour at `top_value` to
 * the bottom colour at `bottom_value`, clipped to the two plots. The step from bar
 * `i - 1` to bar `i` is shaded with bar `i`'s values and colours — the rule a
 * per-bar line colour already follows here; which bar TradingView uses for the
 * step is NOT in the capture (Q-W19R2c), and neither is the shade outside
 * `[bottom_value, top_value]` (a canvas gradient pads with its end colours).
 *
 * ⛔ A STEP IS SHADED ONLY WHERE EVERY INPUT IS PRESENT: both edges at both bars,
 * both values and both colours at bar `i`. An `na` colour or value is a gap (R30),
 * and a lone bar has no step to shade. Equal values (no extent) shade nothing.
 *
 * @returns {Array<{poly: Array<{x:number,y:number}>, y0: number, y1: number, c0: string, c1: string}>}
 */
export function gradientSteps({ upper, lower, times, colors, gradient, timeToX, priceToY }) {
  const out = []
  // ⛔ `{missing: true}` (the binder's fail-closed answer) carries no columns, so
  // every step below finds no bottom colour and NOTHING is drawn — one guard, the
  // per-step one, rather than a second check over the same fact.
  if (!gradient || !upper || !lower || !times || !colors) return out
  const { top, bottom, bottomColors } = gradient
  const n = Math.min(upper.length, lower.length, times.length)
  for (let i = 1; i < n; i += 1) {
    const c0 = colors[i]
    const c1 = bottomColors && bottomColors[i]
    if (c0 == null || c1 == null) continue
    if (![upper[i - 1], lower[i - 1], upper[i], lower[i], top[i], bottom[i]].every(Number.isFinite)) continue
    const xa = timeToX(times[i - 1])
    const xb = timeToX(times[i])
    const ys = [upper[i - 1], upper[i], lower[i], lower[i - 1], top[i], bottom[i]].map(priceToY)
    if (xa == null || xb == null || ys.some((y) => y == null)) continue
    if (ys[4] === ys[5]) continue
    out.push({
      poly: [{ x: xa, y: ys[0] }, { x: xb, y: ys[1] }, { x: xb, y: ys[2] }, { x: xa, y: ys[3] }],
      y0: ys[4], y1: ys[5], c0, c1,
    })
  }
  return out
}

/**
 * Traces a smooth curve through `points` onto the CURRENT path, assuming the
 * path's current point is already `points[0]` (a prior `moveTo`/`lineTo`).
 * Quadratic-through-midpoints: the standard, cheap technique for a smooth
 * polyline — each interior point becomes a control point, the curve passing
 * NEAR it rather than through it, while the first and last points are hit
 * exactly, same as a straight-segment path would.
 *
 * ⭐⭐ WHY THIS EXISTS (2026-09-19). TradingView's own rendering of a Pine
 * fill's boundary is a smooth curve — confirmed by a direct pixel-level crop
 * of a real vendor capture, no kinks visible at any bar position even at 7x
 * zoom. This engine's fill boundary was a literal polyline: one straight
 * `lineTo` per bar. On smooth data the difference is subtle; on anything with
 * real bar-to-bar noise (which is most real price-derived MAs) it reads as a
 * visibly faceted, "scaled" edge next to TradingView's flowing one — a SEPARATE
 * defect from the opacity-compounding fix above, confirmed by the SAME
 * technique (measure the real pixels, not the plausible theory) after that fix
 * shipped and the shape was still visibly more angular than the reference.
 *
 * ⛔ ONLY 2 POINTS ⇒ A STRAIGHT LINE, UNCHANGED. There is nothing to smooth
 * with one segment, and this is what keeps the single-bar run's exact pinned
 * corner (`{x±0.5, y}`) byte-identical to before — the geometry from
 * `runPolygon` is untouched either way; only 3+ point edges change shape.
 */
function tracePath(ctx, points) {
  const n = points.length
  if (n <= 1) return
  if (n === 2) { ctx.lineTo(points[1].x, points[1].y); return }
  for (let i = 1; i < n - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2
    const midY = (points[i].y + points[i + 1].y) / 2
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY)
  }
  const last = points[n - 1]
  const secondLast = points[n - 2]
  ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y)
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
        // ⭐⭐ W19-R2 — a gradient band draws its own steps and nothing else; a
        // declared gradient whose columns are missing draws nothing (`missing`).
        if (opts.gradient) {
          const steps = gradientSteps({ upper, lower, times, colors, gradient: opts.gradient, timeToX, priceToY })
          if (!steps.length) return
          target.useMediaCoordinateSpace(({ context: ctx }) => {
            ctx.save()
            for (const st of steps) {
              const grad = ctx.createLinearGradient(0, st.y0, 0, st.y1)
              grad.addColorStop(0, st.c0)
              grad.addColorStop(1, st.c1)
              ctx.beginPath()
              ctx.moveTo(st.poly[0].x, st.poly[0].y)
              for (let j = 1; j < st.poly.length; j += 1) ctx.lineTo(st.poly[j].x, st.poly[j].y)
              ctx.closePath()
              ctx.fillStyle = grad
              ctx.fill()
            }
            ctx.restore()
          })
          return
        }
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
            const style = ctx.fillStyle
            for (const poly of group.polys) {
              ctx.beginPath()
              // poly is [...top, ...bottom.reverse()] with top.length ===
              // bottom.length always (runPolygon pushes both in lockstep) —
              // so the midpoint split recovers each edge exactly. Smooth
              // WITHIN each edge; the two cross-edges (the run's actual
              // start/end, a real vertical wall in the data) stay straight.
              const half = poly.length / 2
              const top = poly.slice(0, half)
              const bottomRev = poly.slice(half)
              ctx.moveTo(top[0].x, top[0].y)
              tracePath(ctx, top)
              ctx.lineTo(bottomRev[0].x, bottomRev[0].y)
              tracePath(ctx, bottomRev)
              ctx.closePath()
              // ⭐⭐ THE COMPOUNDING FIX (Uncharted Clouds, 2026-09-19). `binder.js`
              // gives a "chained" stack of fills (its hostedFills — one
              // createFillPrimitive PER Pine fill() call) one INDEPENDENT primitive
              // per layer, all attached to the SAME series, all drawn onto the SAME
              // shared canvas. Where the underlying plots run close together (near
              // an MA crossover, or really anywhere the 21 interpolated levels
              // compress into a few pixels), several of those independent layers'
              // thin bands geometrically land on the SAME pixels — and each layer
              // composites there with plain `source-over`, so a pixel FIFTEEN
              // layers touch gets fifteen ROUNDS of alpha blending, not one.
              // `1-(1-a)^n` climbs toward full opacity fast even for a modest `a`:
              // measured on the real fixture's own transparency range, a run of
              // bars with a converging fast/slowMA rendered as a nearly SOLID block
              // of the base colour, not the soft 5-55%-opacity gradient the script
              // asked for — which is the "excess opacity" / "scaled" texture this
              // was reported against, and it reproduces with NO other primitive
              // involved: a single isolated thin band, drawn 15-20 times over
              // itself, saturates the same way a real chained stack does.
              //
              // ⛔ NEITHER A STROKE NOR A DIFFERENT GLOBAL BLEND MODE FIXES THIS —
              // both were tried and measured. Stroking a many-vertex, per-bar
              // polyline boundary makes the boundary's own bar-to-bar zigzag
              // visible as a fine ribbed texture (worse, not better). `lighten`
              // still compounds: canvas blend functions only change the RESULT
              // colour, never the alpha math, and alpha compositing onto an
              // already-opaque destination is alpha=1 after the FIRST draw
              // regardless of blend mode — so a second "lighten" pass still pulls
              // the destination toward the new source via its own `(1-as)*Cb` term.
              //
              // ⭐ THE FIX: erase this polygon's OWN footprint before drawing it.
              // `destination-out` with the path's own antialiased coverage clears
              // exactly the pixels (fully or partially, matching real sub-pixel
              // coverage) this polygon is about to repaint — wiping out whatever
              // ANY earlier layer (a sibling primitive, or this same primitive's
              // own previous run) left there — so `source-over` then draws THIS
              // layer's colour at ITS OWN alpha with nothing underneath to compound
              // with. The net effect at a genuinely SHARED boundary between two
              // adjacent (non-overlapping) bands is the same fractional-coverage
              // antialiasing blend a smooth edge always had; the fix only changes
              // pixels where MULTIPLE layers actually overlap.
              ctx.globalCompositeOperation = 'destination-out'
              ctx.fillStyle = '#000'
              ctx.fill()
              ctx.globalCompositeOperation = 'source-over'
              ctx.fillStyle = style
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
