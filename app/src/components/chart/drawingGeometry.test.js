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
  distToSegment, distToLine, extendToEdges, extendRay, cupControlPoint,
  computeAdvancePct, offsetPoints, boundsOf, hitTestDrawing,
} from './drawingGeometry'

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

describe('extendToEdges — contracts that must survive Phase 2', () => {
  const W = 800, H = 400

  it('returns the two full-width crossings for a horizontal line', () => {
    expect(extendToEdges(P(10, 200), P(90, 200), W, H)).toEqual([P(0, 200), P(W, 200)])
  })

  it('returns the two full-height crossings for a vertical line', () => {
    expect(extendToEdges(P(300, 10), P(300, 90), W, H)).toEqual([P(300, 0), P(300, H)])
  })

  it('puts both returned points ON the infinite line through the inputs', () => {
    // THE contract. Whatever pair the algorithm picks, both points must be
    // collinear with p1→p2 — otherwise the rendered line is not the line the
    // user drew. Phase 2 must keep this exactly.
    const a = P(100, 100), b = P(300, 250)
    const [e1, e2] = extendToEdges(a, b, W, H)
    const cross = (p) => (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)
    expect(cross(e1)).toBeCloseTo(0, 6)
    expect(cross(e2)).toBeCloseTo(0, 6)
  })

  it('falls back to the input points when it cannot find two crossings', () => {
    const a = P(10, 10), b = P(10, 10)   // degenerate: dx === 0 short-circuits
    expect(extendToEdges(a, b, W, H)).toEqual([P(10, 0), P(10, H)])
  })
})

describe('⚠️ CHARACTERISATION — extendToEdges as it ships today (Phase 2 replaces this)', () => {
  const W = 800, H = 400

  // ⚰️ ONE GEOMETRY, TWO BUGS. Direction (+20,−80) from y=20: the left-edge
  // crossing is at y=420 — twenty pixels BELOW an H=400 canvas — and the ±100
  // slack waves it through. The same direction from y=120 flips the returned
  // order. Both characterisations below use this exact case so the Phase 2 fix
  // has one concrete shape to be judged against.
  const STEEP = { p1: P(100, 20), p2: P(120, -60) }        // dx +20, dy −80

  it('admits crossings up to 100px OUTSIDE the box, so a drawn point can be off-canvas', () => {
    const [e1] = extendToEdges(STEEP.p1, STEEP.p2, W, H)
    expect(e1.x).toBe(0)
    expect(e1.y).toBeCloseTo(420, 6)
    expect(e1.y).toBeGreaterThan(H)          // BELOW the canvas — accepted anyway
    expect(e1.y).toBeLessThanOrEqual(H + 100)
  })

  it('picks its pair by PUSH ORDER, so which edges win flips with the slope', () => {
    // ⚰️ THIS IS THE PITCHFORK "lines jump / skip around" REPORT, reduced.
    // Two lines through the same pivot, 1° apart in slope. One is shallow enough
    // that both side crossings pass the ±100 test; the other is not, so the
    // resolver silently switches to the top/bottom crossings — and the segment
    // the user sees changes identity mid-zoom for no reason they can perceive.
    const pivot = P(400, 200)
    const shallow = extendToEdges(pivot, P(500, 210), W, H)
    const steep = extendToEdges(pivot, P(500, 900), W, H)
    const edgesOf = (pair) => pair.map((p) =>
      p.x === 0 ? 'left' : p.x === W ? 'right' : p.y === 0 ? 'top' : 'bottom')
    expect(edgesOf(shallow)).toEqual(['left', 'right'])
    expect(edgesOf(steep)).toEqual(['top', 'bottom'])
  })

  it('gives PARALLEL lines endpoints in inconsistent order — the bow-tie fill', () => {
    // ⚰️ THIS IS THE PARALLEL CHANNEL "part of the tint disappears" REPORT.
    // `renderChannel` fills the quad [a1, b1, b2, a2], which is only a quad if
    // the two parallel edges come back pointing the same way. They do not:
    const dx = 20, dy = -80
    const lineA = extendToEdges(P(100, 20), P(100 + dx, 20 + dy), W, H)
    const lineB = extendToEdges(P(100, 120), P(100 + dx, 120 + dy), W, H)
    expect(lineA).toEqual([P(0, 420), P(105, 0)])     // up-and-right
    expect(lineB).toEqual([P(130, 0), P(30, 400)])    // down-and-left
    const along = (pair) => (pair[1].x - pair[0].x) * dx + (pair[1].y - pair[0].y) * dy
    // Same direction vector; opposite traversal. Build [a1,b1,b2,a2] from these
    // and the polygon crosses itself, so the nonzero winding fill cancels part
    // of its own area — which is exactly what the user sees go missing.
    expect(Math.sign(along(lineA))).not.toBe(Math.sign(along(lineB)))
  })
})

describe('extendRay — one anchored end, one edge end', () => {
  const W = 800, H = 400

  it('keeps the origin point untouched as the first element', () => {
    const a = P(100, 100)
    expect(extendRay(a, P(300, 200), W, H)[0]).toBe(a)
  })

  it('extends in the p1 → p2 direction, never backwards', () => {
    const a = P(400, 200), b = P(500, 200)
    const [, far] = extendRay(a, b, W, H)
    expect((far.x - a.x) * (b.x - a.x)).toBeGreaterThan(0)
    expect(far.x).toBe(W)
  })

  it('reverses correctly when p2 is to the LEFT of p1', () => {
    const a = P(400, 200), b = P(300, 200)
    const [, far] = extendRay(a, b, W, H)
    expect(far.x).toBe(0)
  })

  it('returns the inputs unchanged for a zero-length ray', () => {
    const a = P(5, 5), b = P(5, 5)
    expect(extendRay(a, b, W, H)).toEqual([a, b])
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
  const hit = (type, pts, mx, my, extra = {}) =>
    hitTestDrawing({ type, ...extra }, pts, mx, my, W, H)

  it('returns false for a drawing with no resolved points', () => {
    expect(hitTestDrawing({ type: 'trendline' }, [], 10, 10, W, H)).toBe(false)
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

  it('horizontal: hits at ANY x — it spans the chart', () => {
    expect(hit('horizontal', [P(400, 200)], 0, 200)).toBe(true)
    expect(hit('horizontal', [P(400, 200)], W, 200)).toBe(true)
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
