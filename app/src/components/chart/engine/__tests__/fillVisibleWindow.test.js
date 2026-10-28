// app/src/components/chart/engine/__tests__/fillVisibleWindow.test.js
//
// ─── ⭐⭐ A FILL PAYS FOR THE BARS ON SCREEN, NOT FOR THE SERIES ──────────────
//
// ⚰️ 2026-10-28, measured on production with a CPU profile: Uncharted Clouds (24
// plots, 20 chained fill() bands) on a ~5,000-bar daily chart held the main thread
// 63-96% busy at 3-5 fps while live ticks arrived. Every draw of every band walked
// the whole series — a `timeToCoordinate` and two `priceToCoordinate` per bar, and
// an erase + paint for every run in history — because lightweight-charts 5.2
// answers a coordinate for an OFF-screen bar too, so nothing was ever culled.
//
// Three rails, each against a lightweight-charts-shaped double whose coordinate
// maps are the library's own shape (bar x affine in the time-scale index; price y
// affine, or affine in log10 on a log scale) and whose every coordinate call is
// COUNTED:
//
//   1. work per paint does not grow with series length;
//   2. a last-bar-only update re-resolves only the tail, and a no-change redraw
//      re-resolves nothing;
//   3. ⛔⛔ what is drawn on the canvas is what the full walk draws — every path
//      segment that reaches the visible strip is identical, in order, in colour.
//
// ⛔ The reference for (3) is the FULL WALK, `fillGroups` with no window: the
// unchanged algorithm the primitive ran before this change (and still runs when it
// cannot prove a window). A rail comparing the window to itself would prove nothing.
import { describe, it, expect } from 'vitest'
import { createFillPrimitive, fillGroups, visibleWindow, EDGE_BARS, EDGE_PAD_PX } from '../fillPrimitive'
import { createRecordingCtx } from './fakeChart'
import { W, band, visibleSegments } from './fillTestKit'

// ⚠️ WHY A DOUBLE OF ITS OWN, NOT `fakeChart.js`: the shared fake's time scale has
// no `width()` (its `width: () => 0` belongs to the PRICE scale), so every older
// fill test draws through the full-walk FALLBACK. That keeps their byte-level
// pins stable, and it means none of them exercises the window. This file and
// `fillRealChart.test.js` (the real lightweight-charts, daily string times) are
// what cover the windowed path.
const H = 400

/** A lightweight-charts-shaped chart + host series. `offset` is the (fractional)
 *  time-scale index sitting at x = 0, `spacing` the bar spacing in px. */
function lwcLike({ times, spacing = 10, offset = 0, mode = 0, min = 50, max = 150, extraTimes = [], nullTimes = new Set() }) {
  // A BusinessDay object keys by value, as the library's own `horzScaleBehavior` does.
  const key = (t) => (t && typeof t === 'object' ? t.year * 10000 + t.month * 100 + t.day : t)
  const all = [...new Set([...times, ...extraTimes].map(key))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const index = new Map(all.map((t, i) => [t, i]))
  const counts = { time: 0, price: 0 }
  const view = { spacing, offset, min, max, mode }
  const ts = {
    width: () => W,
    timeToCoordinate: (t) => {
      counts.time += 1
      const i = index.get(key(t))
      return i === undefined || nullTimes.has(key(t)) ? null : (i - view.offset) * view.spacing
    },
    getVisibleLogicalRange: () => ({ from: view.offset, to: view.offset + W / view.spacing }),
  }
  const f = (p) => (view.mode === 1 ? Math.log10(p) : p)
  const series = {
    priceToCoordinate: (p) => {
      counts.price += 1
      return H - ((f(p) - f(view.min)) / (f(view.max) - f(view.min))) * H
    },
    priceScale: () => ({ options: () => ({ mode: view.mode }) }),
  }
  const chart = { timeScale: () => ts }
  return { chart, series, counts, view, calls: () => counts.time + counts.price, reset: () => { counts.time = 0; counts.price = 0 } }
}

function draw(prim, env) {
  const rec = createRecordingCtx()
  prim.primitive.paneViews()[0].renderer().draw(rec.target)
  return rec
}

function attach(data, env) {
  const prim = createFillPrimitive({ ...data, color: '#2962FF', opacity: 0.2 })
  prim.primitive.attached({ chart: env.chart, series: env.series, requestUpdate: () => {} })
  return prim
}

/** The full walk drawn through the SAME canvas code — the reference. */
function fullWalkRecording(data, env) {
  // A chart with no `width()` cannot prove a window, so the primitive takes the
  // full walk: the pre-change algorithm, through the very same draw loop.
  const blind = { timeScale: () => ({ timeToCoordinate: env.chart.timeScale().timeToCoordinate }) }
  const prim = createFillPrimitive({ ...data, color: '#2962FF', opacity: 0.2 })
  prim.primitive.attached({ chart: blind, series: env.series, requestUpdate: () => {} })
  return draw(prim)
}

describe('rail 1 — work per paint does not grow with series length', () => {
  const callsFor = (n, shape = 'number') => {
    // phase = n: the bars at the right edge carry the SAME values for both lengths.
    const data = band(n, { phase: n, iso: shape !== 'number' })
    if (shape === 'businessDay') {
      data.times = data.times.map((d) => ({ year: +d.slice(0, 4), month: +d.slice(5, 7), day: +d.slice(8, 10) }))
    }
    // Same viewport for both: the last 80 bars (10 px each) right-anchored.
    const env = lwcLike({ times: data.times, spacing: 10, offset: n - 80 + 0.37 })
    const prim = attach(data, env)
    env.reset()
    const rec = draw(prim, env)
    return { calls: env.calls(), polys: visibleSegments(rec).length, paints: rec.fillStyles().length }
  }

  it.each(['number', 'iso', 'businessDay'])('⛔⛔ [%s times] 500 bars and 5,000 bars cost the same coordinate calls and the same polygons', (shape) => {
    // ⛔⛔ `iso` IS THE PRODUCTION SHAPE OF EVERY DAILY CHART ('YYYY-MM-DD'). The
    // first cut accepted numeric times only and fell back to the full walk on
    // every D/W/M chart — this row is the rail that review demanded.
    const small = callsFor(500, shape)
    const big = callsFor(5000, shape)
    // Visible bars ≈ 80 (+ the 2×EDGE_BARS margin); three calls per bar plus the
    // O(log n) window search plus the five-sample mapping proof.
    const windowBars = 80 + 2 * EDGE_BARS + 2
    expect(big.calls, `5,000 bars made ${big.calls} coordinate calls`).toBeLessThan(3 * windowBars + 2 * 14 + 10)
    // log2(5000) - log2(500) ≈ 3.3 ⇒ at most ~8 more probes, never ~13,500 more.
    expect(big.calls - small.calls, 'cost grew with history, not with the viewport').toBeLessThanOrEqual(10)
    expect(big.paints, 'polygons painted grew with history').toBe(small.paints)
  })

  it('⛔ NON-VACUITY — the same 5,000 bars drawn without a provable window DO cost the whole series', () => {
    // Proves the counter is live: if this ever reads small, rail 1 is measuring
    // a double that answers nothing.
    const data = band(5000)
    const env = lwcLike({ times: data.times, spacing: 10, offset: 5000 - 80 })
    env.reset()
    fullWalkRecording(data, env)
    expect(env.calls()).toBeGreaterThan(3 * 4900)
  })
})

describe('rail 2 — a live tick rebuilds only the tail', () => {
  it('⛔⛔ a no-change redraw resolves NO bar coordinates; a last-bar tick resolves ONE bar', () => {
    const n = 5000
    const data = band(n)
    const env = lwcLike({ times: data.times, spacing: 10, offset: n - 80 + 0.5 })
    const prim = attach(data, env)
    draw(prim, env)

    // ── a crosshair move: same columns, same mapping ──
    env.reset()
    draw(prim, env)
    const searchAndProof = env.calls()
    // window search (2 × ⌈log2 5000⌉) + 3 x-samples + 2 y-samples, no per-bar call
    expect(searchAndProof, 'a redraw with nothing changed re-resolved bars').toBeLessThanOrEqual(2 * 13 + 5)

    // ── a live tick: the binder re-feeds NEW arrays, only the last bar moved ──
    const upper = Float64Array.from(data.upper)
    const lower = Float64Array.from(data.lower)
    upper[n - 1] += 0.75
    const colors = [...data.colors]
    prim.setOptions({ upper, lower, times: [...data.times], colors })
    env.reset()
    const rec = draw(prim, env)
    expect(env.calls(), 'a last-bar tick re-resolved more than the last bar')
      .toBeLessThanOrEqual(searchAndProof + 3)

    // …and the incremental answer is exactly a fresh primitive's answer.
    const fresh = attach({ upper, lower, times: data.times, colors }, env)
    expect(visibleSegments(rec)).toEqual(visibleSegments(draw(fresh, env)))
  })

  it('⛔ a tick that changes ONLY a colour (the condition flipped) repaints that run', () => {
    const n = 1200
    const data = band(n)
    const env = lwcLike({ times: data.times, spacing: 10, offset: n - 80 })
    const prim = attach(data, env)
    draw(prim, env)
    const colors = [...data.colors]
    colors[n - 1] = colors[n - 1].startsWith('rgba(0') ? 'rgba(136, 14, 79, 0.3)' : 'rgba(0, 137, 123, 0.3)'
    prim.setOptions({ colors })
    const rec = draw(prim, env)
    const ref = visibleSegments(draw(attach({ ...data, colors }, env), env))
    expect(visibleSegments(rec)).toEqual(ref)
    expect(ref.at(-1).colour, 'NON-VACUITY: the flipped bar paints the new colour').toBe(colors[n - 1])
  })

  it('⛔ a MAPPING change (autoscale / scroll) re-resolves the window — never reuses a stale pixel', () => {
    const n = 2000
    const data = band(n)
    const env = lwcLike({ times: data.times, spacing: 10, offset: n - 80 })
    const prim = attach(data, env)
    draw(prim, env)
    env.view.max = 151 // autoscale moved: every y changes
    const rec = draw(prim, env)
    const fresh = attach(data, env)
    expect(visibleSegments(rec)).toEqual(visibleSegments(draw(fresh, env)))
    env.view.offset -= 3.25 // scroll
    const rec2 = draw(prim, env)
    expect(visibleSegments(rec2)).toEqual(visibleSegments(draw(attach(data, env), env)))
  })

  // ⛔⛔ THE x PROOF, RAILED BY MOVES THAT KEEP THE WINDOW'S BOUNDS. Every case above
  // that moves the time axis also moves `from`/`to`, so a cache that skipped the
  // three x samples entirely survived them (review mutant M4). These two keep the
  // window bounds IDENTICAL — asserted, not assumed — so only the x proof can
  // notice the move.
  const windowOf = (env, n) => visibleWindow(n, (i) => env.chart.timeScale().timeToCoordinate(env.timesRef[i]), W)

  it('⛔⛔ a SUB-BAR PAN (0.3 bar = 3 px, same window bounds) re-resolves — no stale x', () => {
    const n = 2000
    const data = band(n)
    const env = lwcLike({ times: data.times, spacing: 10, offset: n - 80 + 0.2 })
    env.timesRef = data.times
    const prim = attach(data, env)
    draw(prim, env)
    const before = windowOf(env, n)
    env.view.offset += 0.3
    expect(windowOf(env, n), 'NON-VACUITY: the pan must keep the window bounds').toEqual(before)
    const rec = draw(prim, env)
    expect(visibleSegments(rec)).toEqual(visibleSegments(draw(attach(data, env), env)))
  })

  it('⛔⛔ a BAR-SPACING change with the same window bounds re-resolves — no stale x', () => {
    const n = 2000
    const data = band(n)
    const env = lwcLike({ times: data.times, spacing: 10, offset: n - 80 + 0.5 })
    env.timesRef = data.times
    const prim = attach(data, env)
    draw(prim, env)
    const before = windowOf(env, n)
    env.view.spacing = 10.04
    expect(windowOf(env, n), 'NON-VACUITY: the zoom must keep the window bounds').toEqual(before)
    const rec = draw(prim, env)
    expect(visibleSegments(rec)).toEqual(visibleSegments(draw(attach(data, env), env)))
  })

  it('⛔ a probe that does NOT resolve proves nothing: null === cached null is no licence to reuse', () => {
    // The three x samples' bars are absent from the time scale (null), the rest
    // resolve, and the axis pans. Two nulls compare equal — the reuse they would
    // license is exactly the stale-pixel defect.
    const n = 1500
    const data = band(n)
    // Pick a viewport whose window search never probes the three sample bars (the
    // search is deterministic, so this is found, not hoped for).
    let env = null
    let win = null
    for (let offset = 600.2; offset < 900 && !env; offset += 7) {
      const probe = lwcLike({ times: data.times, spacing: 10, offset })
      probe.timesRef = data.times
      const w = windowOf(probe, n)
      const mid = (w.from + w.to) >>> 1
      const nulls = new Set([data.times[w.from], data.times[mid], data.times[w.to]])
      const e = lwcLike({ times: data.times, spacing: 10, offset, nullTimes: nulls })
      e.timesRef = data.times
      const again = windowOf(e, n)
      if (again && again.from === w.from && again.to === w.to) { env = e; win = w }
    }
    expect(env, 'NON-VACUITY: no viewport keeps the window search resolvable').not.toBe(null)
    const prim = attach(data, env)
    draw(prim, env)
    env.view.offset += 0.3
    expect(windowOf(env, n)).toEqual(win)
    const rec = draw(prim, env)
    expect(visibleSegments(rec)).toEqual(visibleSegments(draw(attach(data, env), env)))
  })

  it('⛔ daily ISO-string times: a last-bar tick still reuses the window (strings compare by value)', () => {
    const n = 5000
    const data = band(n, { iso: true })
    const env = lwcLike({ times: data.times, spacing: 10, offset: n - 80 + 0.5 })
    const prim = attach(data, env)
    draw(prim, env)
    env.reset()
    draw(prim, env)
    const idle = env.calls()
    expect(idle, 'an idle redraw on string times re-resolved bars').toBeLessThanOrEqual(2 * 13 + 5)
    const upper = Float64Array.from(data.upper)
    upper[n - 1] += 0.5
    prim.setOptions({ upper, lower: Float64Array.from(data.lower), times: data.times.map((t) => `${t}`), colors: [...data.colors] })
    env.reset()
    const rec = draw(prim, env)
    expect(env.calls()).toBeLessThanOrEqual(idle + 3)
    expect(visibleSegments(rec)).toEqual(visibleSegments(fullWalkRecording({ ...data, upper }, env)))
  })

  it('⛔ a LOG scale never reuses a coordinate (no cheap proof exists), and stays correct', () => {
    const n = 1500
    const data = band(n)
    const env = lwcLike({ times: data.times, spacing: 10, offset: n - 80, mode: 1 })
    const prim = attach(data, env)
    draw(prim, env)
    env.reset()
    const rec = draw(prim, env)
    expect(env.calls(), 'a log-scale redraw must re-resolve the window').toBeGreaterThan(3 * 80)
    expect(visibleSegments(rec)).toEqual(visibleSegments(fullWalkRecording(data, env)))
  })
})

describe('rail 3 — the window draws exactly what the full walk draws, on screen', () => {
  const fixtures = {
    'crossing band, colour runs': band(600),
    'NaN holes (incl. at the visible edges)': band(600, { holes: [205, 206, 290, 311, 312, 313, 420, 517, 518] }),
    'displaced edges (a leading NaN offset)': band(600, { lead: 230 }),
    'static colour': band(600, { colours: false }),
    'one-bar runs at the edges': (() => {
      const d = band(600)
      // isolate single bars by NaN neighbours around plausible edge positions
      for (const i of [219, 221, 299, 301]) d.upper[i] = NaN
      return d
    })(),
  }
  // Viewports: a range of zooms and fractional scroll positions, including the
  // series start and end in view, everything in view, and a deep zoom.
  const views = []
  for (const spacing of [0.5, 2, 6, 10, 23, 61]) {
    for (const offset of [-15.3, 0, 211.0, 213.49, 260.77, 410.5, 590.2]) views.push({ spacing, offset })
  }

  for (const [name, data] of Object.entries(fixtures)) {
    it(`⛔⛔ ${name}: every on-canvas segment, colour and polygon order is identical`, () => {
      let compared = 0
      for (const v of views) {
        const env = lwcLike({ times: data.times, ...v })
        const windowed = visibleSegments(draw(attach(data, env), env))
        const reference = visibleSegments(fullWalkRecording(data, env))
        expect(windowed, `spacing ${v.spacing}, offset ${v.offset}`).toEqual(reference)
        compared += reference.length
      }
      // NON-VACUITY: the views really put polygons on screen (at least one per view).
      expect(compared).toBeGreaterThanOrEqual(views.length - 2)
    })
  }

  it('⛔ a time the time scale does not hold still SPLITS the band inside the window', () => {
    const data = band(600)
    const times = [...data.times]
    times[300] = 999_999 // ascending check fails → full walk, which already splits
    const env = lwcLike({ times: data.times, spacing: 10, offset: 260 })
    const d2 = { ...data, times }
    expect(visibleSegments(draw(attach(d2, env), env))).toEqual(visibleSegments(fullWalkRecording(d2, env)))
  })

  it('⛔ an extra time-scale point from ANOTHER series (logical index ≠ bar index) stays exact', () => {
    const data = band(600)
    const extra = [1_000 + 250 * 7 + 3, 1_000 + 251 * 7 + 1, 1_000 + 600 * 7 + 50]
    for (const offset of [240.5, 255.25]) {
      const env = lwcLike({ times: data.times, spacing: 10, offset, extraTimes: extra })
      expect(visibleSegments(draw(attach(data, env), env))).toEqual(visibleSegments(fullWalkRecording(data, env)))
    }
  })

  it('visibleWindow: the margin is EDGE_BARS beyond the last bar left of -EDGE_PAD_PX', () => {
    const xAt = (i) => (i - 100) * 10
    const w = visibleWindow(1000, xAt, W)
    // bar 100 is at x 0; bar 99 at -10 (< -PAD) ⇒ first visible is 100 (x=0 ≥ -8)
    expect(xAt(w.from + EDGE_BARS - 1)).toBeLessThan(-EDGE_PAD_PX)
    expect(w.from).toBe(100 - EDGE_BARS)
    // bar 180 at x 800, 181 at 810 (> W + PAD 808) ⇒ last 180
    expect(w.to).toBe(180 + EDGE_BARS)
    expect(visibleWindow(1000, xAt, undefined), 'no width ⇒ unprovable').toBe(null)
    expect(visibleWindow(1000, () => null, W), 'an unresolvable probe ⇒ unprovable').toBe(null)
  })

  it('⛔ the reference really is the old full walk (fillGroups with no window)', () => {
    // The full-walk primitive path and the pure fillGroups agree polygon for polygon
    // — so rail 3 compares against the pre-change geometry, not a second copy of
    // the new one.
    const data = band(300)
    const env = lwcLike({ times: data.times, spacing: 10, offset: 100 })
    const ts = env.chart.timeScale()
    const groups = fillGroups({
      ...data, timeToX: (t) => ts.timeToCoordinate(t), priceToY: (p) => env.series.priceToCoordinate(p),
    })
    const rec = fullWalkRecording(data, env)
    expect(rec.fillStyles().length).toBe(groups.reduce((s, g) => s + g.polys.length, 0))
  })
})
