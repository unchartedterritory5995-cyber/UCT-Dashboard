/* The drawing layer's geometry, executed — for the first time.
 *
 * ⛔ WHY THIS FILE IS THE POINT OF PHASE 0. Every function under test here was
 * module-private inside a 3,411-line React component. The overlay's existing
 * tests (`placementHud`, `drawingAlertMode`) say so in their own headers and
 * read SOURCE TEXT instead, because a jsdom canvas maps no coordinates and any
 * behavioural assertion through the component would have passed vacuously. So
 * the two geometry bugs the audit found — Pitchfork prongs that jump, a Parallel
 * Channel fill that partly vanishes — could be described but never failed on.
 *
 * ⭐ AND THE KNOWN-BAD BEHAVIOUR IS CHARACTERISED, NOT ASSERTED AS CORRECT.
 * A test that says `extendToEdges` returns off-canvas points is not endorsing
 * that; it is pinning it so Phase 2's replacement has to come and DELETE the
 * pin, in a diff that names what changed. The alternative — leaving it untested
 * until the fix — means the fix lands with nothing to say what it altered for
 * every OTHER caller, and `extendToEdges` has six.
 *
 * Blocks marked ⚠️ CHARACTERISATION are expected to be rewritten by Phase 2.
 * Blocks without that marker are contracts that must survive it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetCoarsePointerForTest, HIT_FINE, HIT_COARSE } from './coarsePointer'
import {
  distToSegment, distToLine, clipLineToRect, extendToEdges, extendLineFar,
  extendRay, cupControlPoint, computeAdvancePct, offsetPoints, boundsOf,
  hitTestDrawing, pointsUsable,
  circleHandlePoints, handlePointsFor, handleDragGain, CIRCLE_HANDLE_GAIN,
} from './drawingGeometry'

// Every geometry call now takes a pane RECT rather than a bare width/height,
// because "the price pane" is not expressible as a width and a height.
const RECT = { x0: 0, y0: 0, x1: 800, y1: 400 }

// ── pointer control ─────────────────────────────────────────────────────────
// Hit radii are pointer-dependent BY DESIGN (8px mouse / 15px finger), read at
// call time. A test that let the ambient environment decide would be measuring
// the runner, so every pointer-sensitive assertion says which pointer it means.
const origMatchMedia = window.matchMedia
function setPointer(coarse) {
  window.matchMedia = vi.fn(() => ({
    matches: coarse, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  }))
  __resetCoarsePointerForTest()
}
beforeEach(() => setPointer(false))
afterEach(() => {
  if (origMatchMedia) window.matchMedia = origMatchMedia
  else delete window.matchMedia
  __resetCoarsePointerForTest()
})

const P = (x, y, extra = {}) => ({ x, y, ...extra })

describe('distToSegment — the workhorse behind every line hit test', () => {
  it('measures perpendicular distance to a point strictly inside the span', () => {
    expect(distToSegment(50, 10, 0, 0, 100, 0)).toBeCloseTo(10, 10)
  })

  it('CLAMPS past the ends — a segment is not an infinite line', () => {
    // (200,0) is 100px past the far endpoint, on the line. A line measure would
    // say 0; a SEGMENT measure must say 100. This is the whole difference
    // between clicking a trendline and clicking its extension.
    expect(distToSegment(200, 0, 0, 0, 100, 0)).toBeCloseTo(100, 10)
    expect(distToSegment(-30, 0, 0, 0, 100, 0)).toBeCloseTo(30, 10)
  })

  it('degenerates to point distance when both ends coincide', () => {
    // Reached whenever a two-point drawing collapses onto one bar. Returning
    // NaN here (0/0) would make the drawing silently unselectable.
    expect(distToSegment(3, 4, 10, 10, 10, 10)).toBeCloseTo(Math.hypot(7, 6), 10)
  })
})

describe('distToLine — infinite-line distance (Extended Line, Channel, Pitchfork)', () => {
  it('does NOT clamp past the ends', () => {
    expect(distToLine(200, 0, 0, 0, 100, 0)).toBeCloseTo(0, 10)
  })

  it('agrees with distToSegment inside the span', () => {
    expect(distToLine(50, 10, 0, 0, 100, 0)).toBeCloseTo(distToSegment(50, 10, 0, 0, 100, 0), 10)
  })

  it('degenerates to point distance on a zero-length line', () => {
    expect(distToLine(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 10)
  })
})

describe('clipLineToRect / extendToEdges — deterministic, Phase 1', () => {
  const W = 800, H = 400
  const R = { x0: 0, y0: 0, x1: W, y1: H }

  it('returns the two full-width crossings for a horizontal line', () => {
    expect(extendToEdges(P(10, 200), P(90, 200), R)).toEqual([P(0, 200), P(W, 200)])
  })

  it('returns the two full-height crossings for a vertical line', () => {
    expect(extendToEdges(P(300, 10), P(300, 90), R)).toEqual([P(300, 0), P(300, H)])
  })

  it('puts both returned points ON the infinite line through the inputs', () => {
    const a = P(100, 100), b = P(300, 250)
    const [e1, e2] = extendToEdges(a, b, R)
    const cross = (p) => (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)
    expect(cross(e1)).toBeCloseTo(0, 6)
    expect(cross(e2)).toBeCloseTo(0, 6)
  })

  // ── the three Phase 0 characterisations, now inverted into invariants ──────

  it('✅ WAS: admitted crossings 100px outside the box. NOW: never leaves the rect', () => {
    // Phase 0 pinned that (100,20)→(120,−60) returned a left-edge crossing at
    // y = 420 on an H = 400 canvas, because a ±100px slack waved it through.
    const [e1, e2] = extendToEdges(P(100, 20), P(120, -60), R)
    for (const e of [e1, e2]) {
      expect(e.x).toBeGreaterThanOrEqual(R.x0 - 1e-9)
      expect(e.x).toBeLessThanOrEqual(R.x1 + 1e-9)
      expect(e.y).toBeGreaterThanOrEqual(R.y0 - 1e-9)
      expect(e.y).toBeLessThanOrEqual(R.y1 + 1e-9)
    }
  })

  it('✅ WAS: the chosen edge pair flipped with the slope. NOW: continuous', () => {
    // Phase 0 pinned that a shallow line resolved to [left, right] and a steep one
    // to [top, bottom] — a discontinuity the user saw as the segment jumping
    // mid-zoom. Sweeping the slope must now move the endpoints smoothly: no step
    // larger than a few px for a 0.5px change in the second anchor.
    const pivot = P(400, 200)
    let prev = null, worst = 0
    for (let dy = -900; dy <= 900; dy += 0.5) {
      const seg = extendToEdges(pivot, P(500, 200 + dy), R)
      expect(seg).not.toBeNull()
      if (prev) {
        const d = Math.min(
          Math.hypot(seg[0].x - prev[0].x, seg[0].y - prev[0].y) + Math.hypot(seg[1].x - prev[1].x, seg[1].y - prev[1].y),
          Math.hypot(seg[0].x - prev[1].x, seg[0].y - prev[1].y) + Math.hypot(seg[1].x - prev[0].x, seg[1].y - prev[0].y),
        )
        worst = Math.max(worst, d)
      }
      prev = seg
    }
    expect(worst).toBeLessThan(12)
  })

  it('✅ WAS: parallel lines came back reversed (the bow-tie). NOW: same direction', () => {
    // Phase 0 pinned direction (+20,−80) returning [(0,420),(105,0)] for one line
    // and [(130,0),(30,400)] for its parallel twin — opposite traversals, which is
    // what turned the Parallel Channel's fill quad into a self-intersecting bow-tie.
    const dx = 20, dy = -80
    const along = (pair) => (pair[1].x - pair[0].x) * dx + (pair[1].y - pair[0].y) * dy
    for (let y = 5; y < 400; y += 7) {
      const seg = extendToEdges(P(100, y), P(100 + dx, y + dy), R)
      if (!seg) continue
      expect(along(seg)).toBeGreaterThan(0)   // ALWAYS traversed p1 -> p2
    }
  })

  it('✅ WAS: a degenerate line sprouted a full-height segment. NOW: a point or nothing', () => {
    // `dx === 0` used to short-circuit to [{x,0},{x,h}] — so two anchors collapsed
    // onto one bar grew a line down the whole chart.
    expect(extendToEdges(P(10, 10), P(10, 10), R)).toEqual([P(10, 10), P(10, 10)])
    expect(extendToEdges(P(-50, -50), P(-50, -50), R)).toBeNull()
  })

  it('returns null — not the raw anchors — when the line misses the rect', () => {
    // The old fallback was `[p1, p2]`, which drew a line where there should be
    // none. `null` means "draw nothing", and every caller now handles it.
    expect(clipLineToRect(P(0, -100), P(800, -100), R)).toBeNull()
    expect(clipLineToRect(P(-10, 0), P(-10, 400), R)).toBeNull()
  })

  it('clips to an OFFSET rect — a volume pane does not start at y = 0', () => {
    const vol = { x0: 0, y0: 300, x1: 800, y1: 400 }
    const seg = clipLineToRect(P(0, 350), P(800, 350), vol)
    expect(seg).toEqual([P(0, 350), P(800, 350)])
    expect(clipLineToRect(P(0, 100), P(800, 100), vol)).toBeNull()   // price-pane line
  })

  it('is stable under a NEARLY vertical and a NEARLY horizontal line', () => {
    const nearV = extendToEdges(P(400, 0), P(400.0001, 400), R)
    expect(nearV[0].y).toBeCloseTo(0, 3)
    expect(nearV[1].y).toBeCloseTo(400, 3)
    const nearH = extendToEdges(P(0, 200), P(800, 200.0001), R)
    expect(nearH[0].x).toBeCloseTo(0, 3)
    expect(nearH[1].x).toBeCloseTo(800, 3)
  })

  it('refuses a malformed rect or non-finite anchors rather than emitting NaN', () => {
    expect(clipLineToRect(P(0, 0), P(1, 1), { x0: 0, y0: 0, x1: 0, y1: 400 })).toBeNull()
    expect(clipLineToRect(P(NaN, 0), P(1, 1), R)).toBeNull()
    expect(clipLineToRect(P(0, 0), P(1, 1), null)).toBeNull()
  })
})

describe('extendLineFar — the band-fill builder', () => {
  const R = { x0: 0, y0: 0, x1: 800, y1: 400 }

  it('spans well beyond the rect in both directions', () => {
    const [a, b] = extendLineFar(P(400, 200), P(500, 200), R)
    expect(a.x).toBeLessThan(R.x0)
    expect(b.x).toBeGreaterThan(R.x1)
  })

  it('always runs p1 -> p2, so two parallel lines can never bow-tie', () => {
    const dx = 20, dy = -80
    const A = extendLineFar(P(100, 20), P(120, -60), R)
    const B = extendLineFar(P(100, 120), P(120, 40), R)
    const along = (pair) => (pair[1].x - pair[0].x) * dx + (pair[1].y - pair[0].y) * dy
    expect(Math.sign(along(A))).toBe(Math.sign(along(B)))
    // and the quad [A0,A1,B1,B0] is convex/simple — no crossing edges
    const seg = (p, q) => ({ p, q })
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    const quad = [A[0], A[1], B[1], B[0]]
    const signs = quad.map((_, i) => Math.sign(cross(quad[i], quad[(i + 1) % 4], quad[(i + 2) % 4])))
    expect(new Set(signs.filter(Boolean)).size).toBe(1)
    expect(seg).toBeTruthy()
  })

  it('returns null for a degenerate direction', () => {
    expect(extendLineFar(P(5, 5), P(5, 5), R)).toBeNull()
  })
})

describe('extendRay — one anchored end, one edge end', () => {
  const R = { x0: 0, y0: 0, x1: 800, y1: 400 }

  it('starts AT the anchor when the anchor is inside the pane', () => {
    expect(extendRay(P(100, 100), P(300, 200), R)[0]).toEqual(P(100, 100))
  })

  it('extends in the p1 -> p2 direction, never backwards', () => {
    const a = P(400, 200), b = P(500, 200)
    const [, far] = extendRay(a, b, R)
    expect((far.x - a.x) * (b.x - a.x)).toBeGreaterThan(0)
    expect(far.x).toBe(R.x1)
  })

  it('reverses correctly when p2 is to the LEFT of p1', () => {
    expect(extendRay(P(400, 200), P(300, 200), R)[1].x).toBe(R.x0)
  })

  it('returns null for a zero-length ray instead of a phantom segment', () => {
    expect(extendRay(P(5, 5), P(5, 5), R)).toBeNull()
  })

  it('returns null when the whole ray is behind the pane', () => {
    // Anchored right of the rect, pointing further right: nothing to draw.
    expect(extendRay(P(900, 200), P(1000, 200), R)).toBeNull()
  })

  it('draws only the visible part when the anchor is off-screen', () => {
    const seg = extendRay(P(-200, 200), P(0, 200), R)
    expect(seg[0]).toEqual(P(0, 200))
    expect(seg[1]).toEqual(P(800, 200))
  })

  it('respects an offset pane — a volume ray never reaches the candles', () => {
    const vol = { x0: 0, y0: 300, x1: 800, y1: 400 }
    const seg = extendRay(P(100, 350), P(200, 340), vol)
    for (const q of seg) expect(q.y).toBeGreaterThanOrEqual(300 - 1e-9)
  })
})

describe('cupControlPoint — the quadratic passes THROUGH the bottom anchor', () => {
  it('places the control point so B(0.5) is exactly the bottom anchor', () => {
    const L = P(0, 0), B = P(40, 100), R = P(200, 20)
    const c = cupControlPoint(L, B, R)
    const at = (t, k) => (1 - t) ** 2 * L[k] + 2 * (1 - t) * t * c[k] + t ** 2 * R[k]
    expect(at(0.5, 'x')).toBeCloseTo(B.x, 10)
    expect(at(0.5, 'y')).toBeCloseTo(B.y, 10)
  })
})

describe('computeAdvancePct — direction decides which extremes are used', () => {
  const bar = (o, h, l, c) => ({ o, h, l, c })

  it('an ADVANCE measures A.low → B.high (the full run-up)', () => {
    // low 10 → high 15 = +50%. Not open→close, not high→high.
    expect(computeAdvancePct(bar(11, 12, 10, 11), bar(14, 15, 13, 14))).toBeCloseTo(50, 10)
  })

  it('a DECLINE measures A.high → B.low and comes back NEGATIVE', () => {
    // high 20 → low 10 = −50%. The sign is what anchors the label below the
    // trough instead of above the high.
    expect(computeAdvancePct(bar(19, 20, 18, 19), bar(11, 12, 10, 11))).toBeCloseTo(-50, 10)
  })

  it('classifies by MIDPOINT, not by close', () => {
    // B closes lower than A but sits higher overall — still an advance.
    const a = bar(10, 11, 9, 10.5), b = bar(20, 22, 18, 19)
    expect(computeAdvancePct(a, b)).toBeGreaterThan(0)
  })

  it('returns null rather than Infinity/NaN on missing or zero-base data', () => {
    expect(computeAdvancePct(null, bar(1, 2, 1, 1))).toBeNull()
    expect(computeAdvancePct(bar(1, 2, undefined, 1), bar(1, 2, 1, 1))).toBeNull()
    expect(computeAdvancePct(bar(0, 0, 0, 0), bar(2, 3, 2, 2))).toBeNull()
  })
})

describe('offsetPoints — Duplicate and Paste must not land exactly on top', () => {
  it('nudges a price-anchored point DOWN by 0.5%', () => {
    expect(offsetPoints([{ time: 't', price: 100 }])).toEqual([{ time: 't', price: 99.5 }])
  })

  it('nudges a volume-pane point by pane fraction, leaving price alone', () => {
    const [p] = offsetPoints([{ time: 't', price: 100, paneRelY: 0.8 }])
    expect(p.paneRelY).toBeCloseTo(0.83, 10)
    expect(p.price).toBe(100)   // paneRelY wins; price is carried, not moved
  })

  it('clamps paneRelY at 1 so a clone cannot be pushed off the bottom', () => {
    expect(offsetPoints([{ paneRelY: 0.99 }])[0].paneRelY).toBe(1)
  })

  it('preserves every other point field, futureBars included', () => {
    const [p] = offsetPoints([{ time: 't', price: 50, futureBars: 12 }])
    expect(p.futureBars).toBe(12)
  })

  it('survives a missing or empty point list', () => {
    expect(offsetPoints(undefined)).toEqual([])
    expect(offsetPoints([])).toEqual([])
  })
})

describe('boundsOf — one answer for rect, circle and measure', () => {
  it('normalises regardless of which corner was clicked first', () => {
    const a = boundsOf([P(100, 80), P(20, 10)])
    const b = boundsOf([P(20, 10), P(100, 80)])
    expect(a).toEqual(b)
    expect(a).toEqual({ x1: 20, y1: 10, x2: 100, y2: 80, w: 80, h: 70 })
  })
})

describe('hitTestDrawing — per type', () => {
  const W = 800, H = 400
  const R = { x0: 0, y0: 0, x1: W, y1: H }
  const hit = (type, pts, mx, my, extra = {}) =>
    hitTestDrawing({ type, ...extra }, pts, mx, my, R)

  it('returns false for a drawing with no resolved points', () => {
    expect(hitTestDrawing({ type: 'trendline' }, [], 10, 10, R)).toBe(false)
  })

  it('trendline: inside the grab radius hits, just outside misses', () => {
    const pts = [P(100, 100), P(300, 100)]
    expect(hit('trendline', pts, 200, 100 + HIT_FINE - 1)).toBe(true)
    expect(hit('trendline', pts, 200, 100 + HIT_FINE + 1)).toBe(false)
  })

  it('trendline: a click past the endpoint MISSES (segment, not line)', () => {
    expect(hit('trendline', [P(100, 100), P(300, 100)], 500, 100)).toBe(false)
  })

  it('extended: the same click past the endpoint HITS (line, not segment)', () => {
    expect(hit('extended', [P(100, 100), P(300, 100)], 500, 100)).toBe(true)
  })

  it('ray: hits forward of the origin, misses behind it', () => {
    const pts = [P(400, 200), P(500, 200)]
    expect(hit('ray', pts, 700, 200)).toBe(true)
    expect(hit('ray', pts, 100, 200)).toBe(false)
  })

  it('⭐ a HORIZONTAL LINE has no time, and must still work', () => {
    // CAUGHT IN-BROWSER. A horizontal is stored as { price } with no time, so it
    // resolves with no x at all. A blanket both-axes validity check made every
    // horizontal line in the product silently stop rendering and stop being
    // clickable. Validity is per AXIS.
    const noX = [{ x: null, y: 200, hasX: false, hasY: true, valid: false }]
    expect(hit('horizontal', noX, 400, 200)).toBe(true)
    expect(hit('horizontal', noX, 400, 260)).toBe(false)
  })

  it('⭐ a VERTICAL LINE is the mirror case — x, no price', () => {
    const noY = [{ x: 400, y: null, hasX: true, hasY: false, valid: false }]
    expect(hit('vertical', noY, 400, 300)).toBe(true)
    expect(hit('vertical', noY, 500, 300)).toBe(false)
  })

  it('pointsUsable asks per axis', () => {
    const p = [{ x: 10, y: null }]
    expect(pointsUsable(p, 1)).toBe(false)
    expect(pointsUsable(p, 1, 'x')).toBe(true)
    expect(pointsUsable(p, 1, 'y')).toBe(false)
  })

  it('horizontal: hits at ANY x — it spans the chart', () => {
    expect(hit('horizontal', [P(400, 200)], 0, 200)).toBe(true)
    expect(hit('horizontal', [P(400, 200)], W, 200)).toBe(true)
  })

  it('⭐ a click OUTSIDE the drawing’s pane is not a hit', () => {
    // The clip and the hit test must agree. A price-pane horizontal is clipped
    // out of the volume pane, so it must stop swallowing clicks there too — an
    // invisible hitbox is worse than the bleed it replaced.
    const price = { x0: 0, y0: 0, x1: W, y1: 300 }
    expect(hitTestDrawing({ type: 'horizontal' }, [P(400, 200)], 400, 200, price)).toBe(true)
    expect(hitTestDrawing({ type: 'horizontal' }, [P(400, 350)], 400, 350, price)).toBe(false)
  })

  it('⭐ an UNRESOLVABLE anchor never becomes a hit at x = 0', () => {
    // The bug this replaces: a null x coerced to 0, so the drawing was grabbable
    // at the chart's left edge, nowhere near where it was drawn.
    const broken = [{ x: null, y: 100, valid: false }, P(300, 100)]
    expect(hit('trendline', broken, 0, 100)).toBe(false)
    expect(hit('trendline', broken, 150, 100)).toBe(false)
  })

  it('hray: hits at and to the right of its anchor, misses well to the left', () => {
    expect(hit('hray', [P(400, 200)], 600, 200)).toBe(true)
    expect(hit('hray', [P(400, 200)], 100, 200)).toBe(false)
  })

  it('rect and circle share one bounding-box test, padded by the grab radius', () => {
    const pts = [P(100, 100), P(300, 200)]
    for (const type of ['rect', 'circle']) {
      expect(hit(type, pts, 200, 150)).toBe(true)                     // inside
      expect(hit(type, pts, 100 - HIT_FINE + 1, 150)).toBe(true)      // within pad
      expect(hit(type, pts, 100 - HIT_FINE - 2, 150)).toBe(false)     // outside pad
    }
  })

  it('measure hits ONLY inside the box — no padding', () => {
    const pts = [P(100, 100), P(300, 200)]
    expect(hit('measure', pts, 200, 150)).toBe(true)
    expect(hit('measure', pts, 99, 150)).toBe(false)
  })

  it('text: box grows with fontSize and wraps at boxWidth', () => {
    const pts = [P(100, 100)]
    expect(hit('text', pts, 105, 110, { text: 'hello', fontSize: 13 })).toBe(true)
    // A tall wrapped note reaches further down than a one-liner.
    const tall = { text: 'a'.repeat(400), fontSize: 13, boxWidth: 60 }
    expect(hit('text', pts, 105, 260, tall)).toBe(true)
    expect(hit('text', pts, 105, 260, { text: 'hello', fontSize: 13 })).toBe(false)
  })

  it('advance: the click strip sits ABOVE the anchor candle', () => {
    const pts = [P(100, 300), P(400, 300)]
    expect(hit('advance', pts, 400, 250)).toBe(true)    // above → in the strip
    expect(hit('advance', pts, 400, 380)).toBe(false)   // well below → out
  })

  it('fib: grabbable at its two anchor levels, not between them', () => {
    const pts = [P(100, 100), P(300, 300)]
    expect(hit('fib', pts, 500, 100)).toBe(true)
    expect(hit('fib', pts, 500, 300)).toBe(true)
    expect(hit('fib', pts, 500, 200)).toBe(false)   // ⚠️ Phase 7 makes levels hittable
  })

  it('pitchfork: grabbed by its median line', () => {
    const pts = [P(100, 300), P(300, 100), P(300, 200)]
    expect(hit('pitchfork', pts, 200, 225)).toBe(true)
    expect(hit('pitchfork', pts, 200, 60)).toBe(false)
  })

  it('cup: follows the CURVE, not the chord between the rims', () => {
    // Rims at y=100, bottom anchor at y=300. The quadratic passes THROUGH the
    // bottom anchor (see cupControlPoint), so the belly is at (200, 300) and the
    // straight chord between the rims — y=100 — is 200px away from the curve.
    const pts = [P(100, 100), P(200, 300), P(300, 100)]
    expect(hit('cup', pts, 200, 300)).toBe(true)     // on the curve's belly
    expect(hit('cup', pts, 200, 100)).toBe(false)    // on the straight chord
    expect(hit('cup', pts, 200, 200)).toBe(false)    // inside the U, touching nothing
  })

  it('position: still hit-testable — the tool is retired in Phase 9, the reader is not', () => {
    const pts = [P(100, 100), P(100, 200), P(100, 50)]
    expect(hit('position', pts, 100, 120)).toBe(true)
  })

  it('avwap: a radius around the anchor dot', () => {
    expect(hit('avwap', [P(200, 200)], 205, 205)).toBe(true)
    expect(hit('avwap', [P(200, 200)], 260, 260)).toBe(false)
  })

  it('an unknown type never claims a click', () => {
    expect(hit('nope', [P(10, 10)], 10, 10)).toBe(false)
  })

  it('READS THE POINTER AT CALL TIME — a finger gets the bigger grab radius', () => {
    // ⛔ The regression guarded here is a module-scope constant. If the radius is
    // ever hoisted out of a function again, an iPad that gains or loses a
    // keyboard mid-session is stuck with whatever it booted with.
    const pts = [P(100, 100), P(300, 100)]
    const justOutsideFine = 100 + HIT_FINE + 2
    expect(hit('trendline', pts, 200, justOutsideFine)).toBe(false)
    setPointer(true)
    expect(HIT_COARSE).toBeGreaterThan(HIT_FINE)
    expect(hit('trendline', pts, 200, justOutsideFine)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ CIRCLE HANDLES — on the border, where the drawing actually is', () => {
  // ⚰️ THE BUG THIS FIXES. A circle stores two BOUNDING-BOX corners and draws an
  // inscribed ellipse, so both stored anchors sit in empty space diagonally
  // outside the shape. The two gold handles floated off the drawing with nothing
  // under them, and grabbing the ellipse's edge did nothing.
  const P = (x, y, extra = {}) => ({ x, y, ...extra })
  /** Is this point on the ellipse inscribed in the two corners? */
  const onEllipse = (h, a, b) => {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2
    return ((h.x - cx) / rx) ** 2 + ((h.y - cy) / ry) ** 2
  }

  it('every tool EXCEPT the circle keeps its handles on its anchors', () => {
    const pts = [P(10, 20), P(30, 40), P(50, 60)]
    for (const t of ['trendline', 'rect', 'arrow', 'fib', 'pitchfork', 'text', 'measure', undefined]) {
      expect(handlePointsFor(t, pts), String(t)).toBe(pts)
    }
  })

  it('⭐ both circle handles land exactly ON the ellipse', () => {
    for (const [a, b] of [
      [P(100, 100), P(300, 200)],     // wide
      [P(100, 100), P(160, 400)],     // tall
      [P(100, 100), P(200, 200)],     // near-circular
      [P(100, 100), P(104, 103)],     // tiny
      [P(0, 0), P(1200, 700)],        // large
      [P(300, 200), P(100, 100)],     // REVERSED anchor order
    ]) {
      const [h0, h1] = handlePointsFor('circle', [a, b])
      expect(onEllipse(h0, a, b)).toBeCloseTo(1, 9)
      expect(onEllipse(h1, a, b)).toBeCloseTo(1, 9)
    }
  })

  it('each handle stays on ITS OWN side — they never swap or collapse', () => {
    const a = P(100, 100), b = P(300, 200)
    const [h0, h1] = handlePointsFor('circle', [a, b])
    expect(h0.x).toBeLessThan(h1.x)
    expect(h0.y).toBeLessThan(h1.y)
    // …and with the anchors stored the other way round, so does the mapping.
    const [r0, r1] = handlePointsFor('circle', [b, a])
    expect(r0.x).toBeGreaterThan(r1.x)
    expect(r0).toMatchObject({ x: h1.x, y: h1.y })
  })

  it('⛔ INDEX i IS STILL ANCHOR i — what the drag path depends on', () => {
    const a = P(100, 100, { time: 111, price: 5 }), b = P(300, 200, { time: 222, price: 9 })
    const out = handlePointsFor('circle', [a, b])
    expect(out).toHaveLength(2)
    // Everything but the pixel position rides along untouched, so nothing
    // downstream can tell it was handed a display position.
    expect(out[0].time).toBe(111)
    expect(out[0].price).toBe(5)
    expect(out[1].time).toBe(222)
  })

  it('a degenerate or unresolvable circle is handed back untouched', () => {
    const flat = [P(100, 100), P(100, 100)]
    const [f0, f1] = handlePointsFor('circle', flat)
    expect([f0.x, f0.y, f1.x, f1.y]).toEqual([100, 100, 100, 100])
    const bad = [P(NaN, 100), P(300, 200)]
    expect(handlePointsFor('circle', bad)).toBe(bad)
    const invalid = [{ valid: false }, P(300, 200)]
    expect(handlePointsFor('circle', invalid)).toBe(invalid)
    expect(handlePointsFor('circle', [P(1, 1)])).toHaveLength(1)
  })

  it('⭐ THE DRAG GAIN MAKES THE HANDLE TRACK THE POINTER EXACTLY', () => {
    // The handle is a blend of both anchors, so moving the anchor 1:1 would leave
    // it trailing the mouse. Move the anchor by gain × delta and the visible dot
    // travels by exactly delta.
    const a = P(100, 100), b = P(300, 200)
    const before = handlePointsFor('circle', [a, b])[0]
    const DELTA = 40
    const gain = handleDragGain('circle', 0)
    const moved = P(a.x + DELTA * gain, a.y)
    const after = handlePointsFor('circle', [moved, b])[0]
    expect(after.x - before.x).toBeCloseTo(DELTA, 9)
  })

  it('the gain is 1 for everything else, and for a whole-body move', () => {
    expect(handleDragGain('circle', null)).toBe(1)     // dragging the body
    expect(handleDragGain('rect', 0)).toBe(1)
    expect(handleDragGain('trendline', 1)).toBe(1)
    expect(handleDragGain('circle', 2)).toBe(1)        // a third point it does not have
    expect(CIRCLE_HANDLE_GAIN).toBeGreaterThan(1)
    expect(CIRCLE_HANDLE_GAIN).toBeCloseTo(1.171572875, 6)
  })

  it('a handle is always INSIDE the anchor bounding box, never outside the shape', () => {
    const a = P(100, 100), b = P(300, 200)
    for (const h of handlePointsFor('circle', [a, b])) {
      expect(h.x).toBeGreaterThanOrEqual(100)
      expect(h.x).toBeLessThanOrEqual(300)
      expect(h.y).toBeGreaterThanOrEqual(100)
      expect(h.y).toBeLessThanOrEqual(200)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ FIB — you can grab every level you can see, and no level you cannot', () => {
  const P2 = (x, y, extra = {}) => ({ x, y, ...extra })
  const pts = [P2(100, 100), P2(300, 300)]
  const rect = { x0: 0, y0: 0, x1: 800, y1: 400 }
  const hitFib = (lines, my) => hitTestDrawing({ type: 'fib' }, pts, 400, my, rect, lines)

  it('hits a level line the painter drew', () => {
    // ⚰️ The old test measured the two ANCHOR rows alone, so a Fib's other nine
    // lines could be seen and not selected — the same complaint Phase 2 fixed
    // for the Pitchfork's prongs.
    const lines = [{ level: 0, y: 100 }, { level: 0.5, y: 200 }, { level: 1, y: 300 }]
    expect(hitFib(lines, 200)).toBe(true)
    expect(hitFib(lines, 100)).toBe(true)
    expect(hitFib(lines, 250)).toBe(false)      // between levels — nothing there
  })

  it('⛔ DOES NOT HIT A LEVEL THE USER HID', () => {
    // The painter does not return a hidden level, so it is not in the list — a
    // level that is not drawn must not keep swallowing clicks.
    const withMid = [{ level: 0, y: 100 }, { level: 0.5, y: 200 }, { level: 1, y: 300 }]
    const without = [{ level: 0, y: 100 }, { level: 1, y: 300 }]
    expect(hitFib(withMid, 200)).toBe(true)
    expect(hitFib(without, 200)).toBe(false)
  })

  it('falls back to the anchors when nothing has been painted yet', () => {
    expect(hitFib(null, 100)).toBe(true)
    expect(hitFib(null, 300)).toBe(true)
    expect(hitFib([], 200)).toBe(false)
  })

  it('stays inside its pane, like every other tool', () => {
    const lines = [{ level: 0.5, y: 200 }]
    expect(hitTestDrawing({ type: 'fib' }, pts, 900, 200, rect, lines)).toBe(false)
    expect(hitTestDrawing({ type: 'fib' }, pts, -5, 200, rect, lines)).toBe(false)
  })
})
