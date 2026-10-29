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
 *
 * ⭐ `from`/`to` (inclusive, optional) RESTRICT THE WALK TO A WINDOW, and the
 * answer is exactly the full answer CLIPPED to that window: every rule here is
 * local (finiteness of one bar, colour equality of two neighbours), so a run that
 * crosses the window's edge comes back starting (or ending) AT the edge with the
 * same colour, and nothing outside the window is read. That is what lets the draw
 * step pay for the visible bars only (see `visibleWindow`).
 */
export function fillRuns(upper, lower, colors, from, to) {
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
  const lo = Number.isInteger(from) && from > 0 ? from : 0
  const end = Number.isInteger(to) && to < n - 1 ? to + 1 : n
  for (let i = lo; i < end; i += 1) {
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
  if (start >= 0) runs.push({ from: start, to: end - 1, color: runColour })
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
  return runPolygonAt(run, (i) => timeToX(times[i]), (i) => priceToY(upper[i]), (i) => priceToY(lower[i]))
}

/**
 * `runPolygon`'s one body, over INDEX accessors rather than value columns.
 *
 * ⛔ ONE AUTHORITY ON THE SHAPE. The primitive's draw resolves coordinates once
 * into per-index arrays (so a live tick can keep the ones it did not change) and
 * hands those arrays here; the pure `runPolygon` above hands the same function
 * closures over its coordinate functions. Two bodies would be two shapes.
 */
function runPolygonAt(run, xAt, yUAt, yLAt) {
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
    const x = xAt(i)
    const yU = yUAt(i)
    const yL = yLAt(i)
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
export function fillGroups({ upper, lower, times, colors, timeToX, priceToY, from, to }) {
  return groupsAt(upper, lower, colors, from, to,
    (i) => timeToX(times[i]), (i) => priceToY(upper[i]), (i) => priceToY(lower[i]))
}

/** `fillGroups`' one body, over index accessors (see `runPolygonAt`). */
function groupsAt(upper, lower, colors, from, to, xAt, yUAt, yLAt) {
  return fillRuns(upper, lower, colors, from, to)
    .map((run) => ({
      color: run.color,
      polys: runPolygonAt(run, xAt, yUAt, yLAt)
        .filter((poly) => poly.length >= 4),
    }))
    .filter((group) => group.polys.length > 0)
}

// ─── ⭐⭐ THE VISIBLE WINDOW (perf, 2026-10-28) ───────────────────────────────
//
// ⚰️ MEASURED IN PRODUCTION: a 24-plot / 20-fill indicator (Uncharted Clouds) on a
// ~5,000-bar daily chart held the main thread 63-96% busy (3-5 fps) while live
// ticks arrived. Every draw of every fill walked the WHOLE series — one
// `timeToCoordinate` and two `priceToCoordinate` calls per bar, and a polygon
// for every run in history, each filled twice (erase + paint) — although only the
// ~200 bars on screen can put a single pixel on the canvas. The header comment on
// `runPolygon` assumed `timeToCoordinate` answers null off-screen; in
// lightweight-charts 5.2 it does NOT (`indexToCoordinate` is a plain affine map),
// so nothing was ever culled.
//
// ⭐ THE WINDOW IS DECIDED IN PIXELS, NOT LOGICAL INDICES. `getVisibleLogicalRange`
// numbers the TIME SCALE's points, which are the union of every series' times;
// this fill's columns are indexed by the BARS. Those agree only when no other
// series adds a time point, which the primitive cannot know. A binary search over
// this fill's own `times` through `timeToCoordinate` asks the question directly —
// which of MY bars land on screen — in O(log n) calls.
//
// ⛔⛔ WHY THE CLIP IS PIXEL-IDENTICAL, NOT MERELY "CLOSE". A polygon cut at bar
// `a` differs from the uncut one only in its first curve segment and its wall:
// `tracePath` starts the cut edge AT `a` and bends toward `a+1` up to
// mid(a+1, a+2), where the uncut edge was already arriving from mid(a, a+1). So
// every difference lies at x <= x(a+2) (symmetrically x >= x(b-2) on the right).
// Cutting `EDGE_BARS = 3` bars beyond the last bar whose x is left of
// `-EDGE_PAD_PX` puts x(a+2) itself left of `-EDGE_PAD_PX`, i.e. off the canvas
// with a margin wider than any antialiasing footprint. Each segment is x-monotone
// (bar x increases with time), so the winding number of every on-canvas point —
// and therefore every on-canvas pixel — is unchanged. A run that does not cross
// the cut is not touched at all, and the destination-out erase of a polygon that
// is entirely off-canvas cleared nothing.
export const EDGE_PAD_PX = 8
export const EDGE_BARS = 3

/**
 * The index window `[from, to]` of bars that can put a pixel on a canvas `width`
 * wide, plus the `EDGE_BARS` margin. `xAt(i)` is bar i's x; it must be
 * non-decreasing in i (the caller proves `times` ascending).
 *
 * @returns {{from:number,to:number}|null} null ⇒ UNPROVABLE (no width, or a probe
 *   whose coordinate did not resolve) — the caller then walks everything, exactly
 *   as before. `from > to` ⇒ nothing can be on screen.
 */
export function visibleWindow(count, xAt, width) {
  if (!(width > 0) || !(count > 0)) return null
  let bad = false
  const x = (i) => {
    const v = xAt(i)
    if (v == null || !Number.isFinite(v)) bad = true
    return v
  }
  // first index whose x is >= -PAD
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (x(mid) >= -EDGE_PAD_PX) hi = mid; else lo = mid + 1
    if (bad) return null
  }
  const first = lo
  // first index whose x is > width + PAD
  lo = first
  hi = count
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (x(mid) > width + EDGE_PAD_PX) hi = mid; else lo = mid + 1
    if (bad) return null
  }
  const last = lo - 1
  return { from: Math.max(0, first - EDGE_BARS), to: Math.min(count - 1, last + EDGE_BARS) }
}

/**
 * A bar time reduced to something that orders the way the time scale orders it,
 * or `undefined` when this primitive cannot vouch for the order.
 *
 * ⛔⛔ DAILY BARS ARE STRINGS. D/W/M bars reach the fill as `'YYYY-MM-DD'`
 * (`api/services/bars_fetch.py` `_fmt_sqlite_bars`; `StockChart`'s `adjustTime`
 * shifts only numbers; the binder hands `bars.map(adjustTime(bar.t))`). The first
 * cut of this change accepted numbers only, so EVERY daily chart — the exact case
 * it was written for — silently took the full walk (measured: 104 vs 5,000
 * `timeToCoordinate` calls per paint). A zero-padded ISO date sorts lexically in
 * date order, so the string itself is its key. A `BusinessDay` object keys as
 * `year·10⁴ + month·10² + day`. Anything else is unknown and falls back.
 */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * The KIND of a bar time, from the RAW value: 'num' | 'iso' | 'bd', or undefined.
 * ⛔ Not `typeof timeKey(t)`: a BusinessDay keys to a number, so a column mixing
 * BusinessDays and timestamps would read as one kind, and the number 20240105
 * would equal `{ year: 2024, month: 1, day: 5 }` — two different bars.
 */
function timeKind(t) {
  if (typeof t === 'number') return Number.isFinite(t) ? 'num' : undefined
  if (typeof t === 'string') return ISO_DAY.test(t) ? 'iso' : undefined
  if (t && typeof t === 'object' && Number.isInteger(t.year) && Number.isInteger(t.month) && Number.isInteger(t.day)) return 'bd'
  return undefined
}

function timeKey(t) {
  if (typeof t === 'number') return Number.isFinite(t) ? t : undefined
  if (typeof t === 'string') return ISO_DAY.test(t) ? t : undefined
  if (t && typeof t === 'object' && Number.isInteger(t.year) && Number.isInteger(t.month) && Number.isInteger(t.day)) {
    return t.year * 10000 + t.month * 100 + t.day
  }
  return undefined
}

/** True when every time has a kind (`timeKind`), all are the SAME kind, and the
 *  column never goes backwards — the precondition for `visibleWindow`'s binary
 *  search. ⚠️ O(n) per new `times` column (the binder hands a new one each sync):
 *  measured ~2-4 ms per sync for 20 fills × 5,000 bars — kept, it is not per paint. */
export function timesAscending(times, m = lengthOf(times)) {
  let prev
  let kind
  for (let i = 0; i < m; i += 1) {
    const t = times[i]
    const kd = timeKind(t)
    if (kd === undefined) return false
    const k = timeKey(t)
    if (i === 0) kind = kd
    else if (kd !== kind || k < prev) return false
    prev = k
  }
  return true
}

/** Two bar times are the same bar: same KIND and same key (a BusinessDay
 *  compares by value, never equal to a number that happens to share its key). */
export const sameTime = (a, b) => a === b
  || (timeKind(a) !== undefined && timeKind(a) === timeKind(b) && timeKey(a) === timeKey(b))

const sameValue = (a, b) => a === b || (a !== a && b !== b) // eslint-disable-line no-self-compare
const lengthOf = (a) => (a && typeof a.length === 'number' ? a.length : 0)

// lightweight-charts `PriceScaleMode`: Normal 0 · Logarithmic 1 · Percentage 2 ·
// IndexedTo100 3. In every mode but Logarithmic `priceToCoordinate` is AFFINE in
// the price for a fixed scale state (percentage/indexed rebase on the first
// visible value, then the same linear map) — see `_private__logicalToCoordinate`.
const AFFINE_PRICE_MODES = new Set([0, 2, 3])

/**
 * ⭐⭐ THE GEOMETRY CACHE — one per primitive.
 *
 * Holds, for the current visible window only, each bar's resolved x / yUpper /
 * yLower plus a copy of the values they were resolved from, and the groups built
 * from them. A draw then costs:
 *
 *   - O(log n) coordinate calls to find the window (`visibleWindow`);
 *   - 5 more to prove the pixel MAPPING is unchanged — x at three of the window's
 *     bars and y at two reference prices. In an affine price mode two points fix
 *     the map, and bar x is affine in the time-scale index, so equal samples mean
 *     every cached coordinate is still exactly what a fresh call would return;
 *   - an O(window) VALUE comparison to find the first bar whose data changed.
 *
 * Nothing changed (a crosshair move, a re-feed of identical columns) ⇒ the cached
 * groups are returned as-is. A live tick that moves only the last bar ⇒ only that
 * bar's three coordinates are resolved again; everything to its left is kept.
 * The mapping moved (scroll, zoom, autoscale, resize, pane/scale change) ⇒ the
 * window is resolved afresh — still the window, never the series.
 *
 * ⚠️ THE KNOWN BLIND SPOT OF THE x PROOF, recorded rather than hidden: bar x is
 * `W − (base + rightOffset − index + ½)·spacing − 1`, and three samples pin it only
 * if the time scale's index of each sampled bar is unchanged. Another series
 * inserting time points into BOTH halves of the window (between `from` and `mid`
 * and between `mid` and `to`) while the bar spacing shrinks by EXACTLY the factor
 * that lands all three sampled bars back on their old x would pass the proof with
 * the bars between them moved. That needs a coincidence of exact floating-point
 * equality across a data change on another series in the same frame; any of the
 * real moves (scroll, zoom, sub-bar pan, a spacing change, a points insertion on
 * one side) moves at least one sample and is railed.
 *
 * ⛔ LOGARITHMIC (or an unreadable mode) NEVER REUSES A COORDINATE: two samples do
 * not pin a log map whose formula itself depends on the visible range, so there
 * is no cheap proof, and an unproved reuse is how a band drifts off its lines.
 * ⛔ AND WHEN THE WINDOW CANNOT BE PROVED (no `width()`, times not ascending
 * (see `timeKey`), a probe that did not resolve) the draw walks the WHOLE series exactly
 * as it always did — the slow path is the old path, not a guess.
 */
function createFillGeometry() {
  let sortedFor = null
  let sortedLen = -1
  let sorted = false
  let c = null
  return {
    reset() { c = null; sortedFor = null; sortedLen = -1 },
    groups({ upper, lower, times, colors, ts, series }) {
      const timeToX = (t) => { try { return ts.timeToCoordinate(t) } catch { return null } }
      const priceToY = (p) => { try { return series.priceToCoordinate(p) } catch { return null } }
      const n = Math.min(lengthOf(upper), lengthOf(lower))
      const m = Math.min(n, lengthOf(times))
      if (times !== sortedFor || m !== sortedLen) {
        sortedFor = times
        sortedLen = m
        sorted = timesAscending(times, m)
      }
      let width = NaN
      try { if (typeof ts.width === 'function') width = ts.width() } catch { width = NaN }
      const win = sorted ? visibleWindow(m, (i) => timeToX(times[i]), width) : null
      if (!win) { c = null; return fillGroups({ upper, lower, times, colors, timeToX, priceToY }) }
      const { from, to } = win
      if (from > to) { c = null; return [] }

      let mode
      try { mode = series.priceScale().options().mode } catch { mode = undefined }
      const affine = AFFINE_PRICE_MODES.has(mode)
      const dyn = lengthOf(colors) > 0
      const mid = (from + to) >>> 1
      const xs3 = () => [timeToX(times[from]), timeToX(times[mid]), timeToX(times[to])]
      // ⛔ A PROBE THAT DID NOT RESOLVE PROVES NOTHING — a null that equals a cached
      // null is two unanswered questions, not one unchanged mapping. ONE guard, at
      // the build: a cache whose references did not all resolve is never kept, so
      // a reuse always compares fresh numbers against cached NUMBERS (a fresh null
      // then fails `===` by itself; a second guard there could not be mutation-proved).
      const resolved = (v) => typeof v === 'number' && Number.isFinite(v)

      const yU = (i) => (Number.isFinite(upper[i]) ? priceToY(upper[i]) : null)
      const yL = (i) => (Number.isFinite(lower[i]) ? priceToY(lower[i]) : null)
      const xAt = (i) => c.xs[i - from]
      const yUAt = (i) => c.yu[i - from]
      const yLAt = (i) => c.yl[i - from]
      const resolve = (i) => {
        const k = i - from
        c.xs[k] = timeToX(times[i])
        c.yu[k] = yU(i)
        c.yl[k] = yL(i)
        c.u[k] = upper[i]
        c.l[k] = lower[i]
        c.t[k] = times[i]
        c.c[k] = dyn ? colors[i] : undefined
      }

      if (affine && c && c.from === from && c.to === to && c.dyn === dyn && c.mode === mode
        && c.width === width) {
        const sx = xs3()
        const y1 = priceToY(c.p1)
        const y2 = priceToY(c.p2)
        if (sx[0] === c.sx[0] && sx[1] === c.sx[1] && sx[2] === c.sx[2]
          && y1 === c.y1 && y2 === c.y2) {
          let d = from
          while (d <= to) {
            const k = d - from
            if (!sameValue(c.u[k], upper[d]) || !sameValue(c.l[k], lower[d]) || !sameTime(c.t[k], times[d])
              || (dyn && c.c[k] !== colors[d])) break
            d += 1
          }
          if (d > to) return c.groups
          for (let i = d; i <= to; i += 1) resolve(i)
          c.groups = groupsAt(upper, lower, colors, from, to, xAt, yUAt, yLAt)
          return c.groups
        }
      }

      // ── a full resolve of the window ──
      const size = to - from + 1
      c = {
        from, to, dyn, mode, width,
        xs: new Array(size), yu: new Array(size), yl: new Array(size),
        u: new Array(size), l: new Array(size), t: new Array(size), c: new Array(size),
        sx: null, p1: 0, p2: 1, y1: null, y2: null, groups: null,
      }
      for (let i = from; i <= to; i += 1) resolve(i)
      c.groups = groupsAt(upper, lower, colors, from, to, xAt, yUAt, yLAt)
      if (affine) {
        // Reference prices at the data's own magnitude, so the proof is taken where
        // the band actually lives rather than at 0 and 1.
        let p1 = NaN
        let p2 = NaN
        for (let k = 0; k < size && !(Number.isFinite(p1) && Number.isFinite(p2)); k += 1) {
          if (!Number.isFinite(p1) && Number.isFinite(c.u[k])) p1 = c.u[k]
          if (!Number.isFinite(p2) && Number.isFinite(c.l[k])) p2 = c.l[k]
        }
        if (!Number.isFinite(p1)) p1 = 0
        if (!Number.isFinite(p2) || p2 === p1) p2 = p1 + 1
        c.p1 = p1
        c.p2 = p2
        c.y1 = priceToY(p1)
        c.y2 = priceToY(p2)
        c.sx = xs3()
        // a reference that did not resolve can never prove a later reuse
        if (c.sx.every(resolved) && resolved(c.y1) && resolved(c.y2)) return c.groups
      }
      const { groups } = c
      c = null
      return groups
    },
  }
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
  const geometry = createFillGeometry()

  const paneView = {
    // ⛔ BELOW THE LINES IT SITS BETWEEN. A band painted over its own edges hides
    // them, and the edges are the indicator; the fill is the annotation.
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!series || !chart) return
        const { upper, lower, times, colors } = opts
        if (!upper || !lower || !times) return
        const groups = geometry.groups({ upper, lower, times, colors, ts: chart.timeScale(), series })
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
      geometry.reset()
    },
    detached: () => { series = null; chart = null; requestUpdate = null; geometry.reset() },
  }

  return {
    primitive,
    setOptions(patch) { opts = { ...opts, ...patch }; if (requestUpdate) requestUpdate() },
  }
}
