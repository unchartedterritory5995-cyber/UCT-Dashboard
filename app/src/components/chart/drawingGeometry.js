/* Deterministic pixel geometry for the drawing layer.
 *
 * ⛔ EVERY FUNCTION HERE IS THE OVERLAY'S OWN BODY, MOVED VERBATIM. Phase 0 is
 * behaviour-neutral by contract: not one comparison, tolerance or early return
 * was "cleaned up" on the way across, because there was no executable test to
 * catch it if the cleanup was wrong. The tests land here first; the fixes land
 * in Phase 1 and 2, as edits with a failing test in front of them.
 *
 * ⭐ WHY THIS BOUNDARY, AND NOT JUST "MAKE THE BIG FILE SMALLER". These are the
 * functions Pitchfork and Parallel Channel are BUILT ON — `extendToEdges` alone
 * has six call sites — and both of their reported bugs are geometry bugs. They
 * were unreachable from a test because they were module-private inside a 3,411
 * line React component whose canvas maps no coordinates under jsdom, which is
 * why the drawing layer's existing tests read SOURCE TEXT instead of running
 * anything. Taking plain numbers in and giving plain numbers back is the whole
 * point: `drawingGeometry.test.js` can now assert the exact failures the audit
 * predicted, and Phase 2 becomes "make these tests go green" instead of "drag
 * the anchors around and squint".
 *
 * ⚠️ KNOWN-WRONG BEHAVIOUR IS PRESERVED AND PINNED, NOT FIXED. `extendToEdges`
 * has a ±100px candidate search whose chosen pair flips as the slope changes;
 * that is the Pitchfork "jump", and the test suite CHARACTERISES it (it asserts
 * what today's code does, and says so) rather than pretending it is correct. Do
 * not silently repair anything in this file — a green suite here is currently a
 * statement that behaviour has not drifted, which is exactly what Phase 0 owes
 * the phases after it.
 */
import { hitThreshold } from './coarsePointer'

// Coarse pointers (finger/stylus) need a bigger grab radius than a mouse.
// ⛔ A FUNCTION, NOT A CONSTANT, AND THAT IS THE POINT — see coarsePointer.js.
// The pointer answer must be read when the gesture happens, never hoisted to
// module scope, or an iPad that gains a keyboard mid-session can never change
// pointer type for the life of the bundle.
const HIT_THRESHOLD = () => hitThreshold()

export function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function distToLine(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - x1, py - y1)
  return Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / Math.sqrt(lenSq)
}

/**
 * Both points where the infinite line through p1,p2 leaves the w×h box.
 *
 * ⚠️ THIS IS THE FUNCTION PHASE 2 REPLACES. Three properties of it are load-
 * bearing bugs, all pinned by test rather than repaired here:
 *   1. the ±100px slack admits crossings that are OFF the canvas, so a steep
 *      line can be drawn between two points that are both outside the box;
 *   2. which two of the four candidates win depends on PUSH ORDER, so the pair
 *      flips discontinuously as the slope changes during a zoom — the Pitchfork
 *      "lines jump/skip" report;
 *   3. the returned pair has no consistent direction, so two PARALLEL lines can
 *      come back with reversed endpoints — build a quad from them and you get a
 *      bow-tie, which is the Parallel Channel "fill disappears" report.
 * Phase 2 swaps this for a parametric clip against the pane rect. Until then it
 * behaves exactly as it has shipped.
 */
export function extendToEdges(p1, p2, w, h) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  if (dx === 0) return [{ x: p1.x, y: 0 }, { x: p1.x, y: h }]
  if (dy === 0) return [{ x: 0, y: p1.y }, { x: w, y: p1.y }]
  const m = dy / dx, b = p1.y - m * p1.x
  const pts = []
  const yAt0 = b, yAtW = m * w + b
  const xAt0 = -b / m, xAtH = (h - b) / m
  if (yAt0 >= -100 && yAt0 <= h + 100) pts.push({ x: 0, y: yAt0 })
  if (yAtW >= -100 && yAtW <= h + 100) pts.push({ x: w, y: yAtW })
  if (xAt0 >= -100 && xAt0 <= w + 100 && pts.length < 2) pts.push({ x: xAt0, y: 0 })
  if (xAtH >= -100 && xAtH <= w + 100 && pts.length < 2) pts.push({ x: xAtH, y: h })
  return pts.length >= 2 ? pts : [p1, p2]
}

export function extendRay(p1, p2, w, h) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  if (dx === 0 && dy === 0) return [p1, p2]
  // Extend from p1 through p2 to edge
  const edges = extendToEdges(p1, p2, w, h)
  // Pick the edge point on the p2 side of p1
  const dotA = (edges[0].x - p1.x) * dx + (edges[0].y - p1.y) * dy
  const dotB = edges[1] ? (edges[1].x - p1.x) * dx + (edges[1].y - p1.y) * dy : -1
  const farPt = dotA >= dotB ? edges[0] : edges[1]
  return [p1, farPt || p2]
}

// Cup curve control point: quadratic B(0.5) = 0.25·L + 0.5·C + 0.25·R; solve C
// so B(0.5) === the bottom anchor, giving a clean U regardless of where the
// bottom sits horizontally.
export function cupControlPoint(L, B, R) {
  return { x: 2 * B.x - 0.5 * (L.x + R.x), y: 2 * B.y - 0.5 * (L.y + R.y) }
}

// Directional price move between two candles, using the TRUE extremes so the
// label reflects the real swing (independent of log/linear scale):
//   • advance (B sits higher than A): A's LOW → B's HIGH   → the full run-up
//   • decline (B sits lower  than A): A's HIGH → B's LOW    → the full draw-down
// Returns a signed % (negative = decline), or null if it can't be computed.
export function computeAdvancePct(A, B) {
  if (!A || !B) return null
  const aHi = A.h, aLo = A.l, bHi = B.h, bLo = B.l
  if ([aHi, aLo, bHi, bLo].some(v => v == null)) return null
  const isDecline = (bHi + bLo) < (aHi + aLo)   // B lower than A on average
  if (isDecline) return aHi > 0 ? (bLo - aHi) / aHi * 100 : null
  return aLo > 0 ? (bHi - aLo) / aLo * 100 : null
}

// Clone a drawing's points with a small visible offset (price −0.5%, or +0.03 of the
// volume-pane fraction), keeping the time anchors. Shared by Duplicate + Paste so a
// clone never lands exactly on top of the original.
export function offsetPoints(points) {
  return (points || []).map(p => ({
    ...p,
    ...(p.paneRelY != null
      ? { paneRelY: Math.min(1, p.paneRelY + 0.03) }
      : (p.price != null ? { price: p.price * 0.995 } : {})),
  }))
}

/** Axis-aligned bounds of the first two resolved points (rect / circle / measure).
 *  ⭐ EXTRACTED BECAUSE IT WAS WRITTEN OUT FOUR TIMES — in renderRect,
 *  renderCircle, renderMeasure and the rect/circle hit test — with the same
 *  Math.min/Math.max pair each time. Same arithmetic, one name. */
export function boundsOf(pts) {
  const x1 = Math.min(pts[0].x, pts[1].x)
  const y1 = Math.min(pts[0].y, pts[1].y)
  const x2 = Math.max(pts[0].x, pts[1].x)
  const y2 = Math.max(pts[0].y, pts[1].y)
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 }
}

// ─── Hit testing ─────────────────────────────────────────────────────────────

export function hitTestDrawing(d, pts, mx, my, w, h) {
  if (!pts.length) return false
  switch (d.type) {
    case 'trendline':
      return pts.length >= 2 && distToSegment(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD()
    case 'ray': {
      if (pts.length < 2) return false
      const [a, b] = extendRay(pts[0], pts[1], w, h)
      return distToSegment(mx, my, a.x, a.y, b.x, b.y) < HIT_THRESHOLD()
    }
    case 'extended': {
      if (pts.length < 2) return false
      return distToLine(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD()
    }
    case 'horizontal':
      return Math.abs(my - pts[0].y) < HIT_THRESHOLD()
    case 'hray':
      return Math.abs(my - pts[0].y) < HIT_THRESHOLD() && mx >= (pts[0].x || 0) - HIT_THRESHOLD()
    case 'vertical':
      return Math.abs(mx - pts[0].x) < HIT_THRESHOLD()
    case 'rect':
    case 'circle': {
      if (pts.length < 2) return false
      const x1 = Math.min(pts[0].x, pts[1].x) - HIT_THRESHOLD()
      const y1 = Math.min(pts[0].y, pts[1].y) - HIT_THRESHOLD()
      const x2 = Math.max(pts[0].x, pts[1].x) + HIT_THRESHOLD()
      const y2 = Math.max(pts[0].y, pts[1].y) + HIT_THRESHOLD()
      return mx >= x1 && mx <= x2 && my >= y1 && my <= y2
    }
    case 'arrow':
      return pts.length >= 2 && distToSegment(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD()
    case 'text': {
      // Bounding box for a possibly-WRAPPED, multi-line note (rendered downward
      // from pts[0].y at lineHeight fs*1.4). Width = the stored box width; height
      // = estimated wrapped line count. Approximation is fine for hit-testing.
      const fs = d.fontSize || 13
      const lineH = fs * 1.4
      let nLines = 0
      for (const para of String(d.text || '').split('\n')) {
        if (d.boxWidth) {
          const w = (para.length || 1) * (fs * 0.55)   // ~avg char width
          nLines += Math.max(1, Math.ceil(w / d.boxWidth))
        } else nLines += 1
      }
      const textW = d.boxWidth || (d.text?.length || 1) * 8
      const textH = Math.max(1, nLines) * lineH
      return mx >= pts[0].x - 4 && mx <= pts[0].x + textW + 4 && my >= pts[0].y - 4 && my <= pts[0].y + textH + 4
    }
    case 'advance': {
      // Label sits above the 2nd point's candle; box a vertical strip above it.
      const p = pts[pts.length - 1]
      if (!p || p.x == null || p.y == null) return false
      return mx >= p.x - 26 && mx <= p.x + 26 && my >= p.y - 70 && my <= p.y + 10
    }
    case 'fib':
    case 'fibext':
      if (pts.length < 2) return false
      return mx >= 0 && mx <= w && (Math.abs(my - pts[0].y) < HIT_THRESHOLD() * 2 || Math.abs(my - pts[1].y) < HIT_THRESHOLD() * 2)
    case 'pitchfork':
      if (pts.length < 3) return false
      return distToLine(mx, my, pts[0].x, pts[0].y, (pts[1].x + pts[2].x) / 2, (pts[1].y + pts[2].y) / 2) < HIT_THRESHOLD() * 2
    case 'channel':
      if (pts.length < 2) return false
      return distToLine(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD() * 2
    case 'cup': {
      if (pts.length < 3) return pts.length >= 2 && distToSegment(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD()
      const L = pts[0], R = pts[2]
      const c = cupControlPoint(L, pts[1], R)
      // Sample the quadratic and test each chord against the cursor.
      let px = L.x, py = L.y
      for (let i = 1; i <= 20; i++) {
        const t = i / 20, u = 1 - t
        const qx = u * u * L.x + 2 * u * t * c.x + t * t * R.x
        const qy = u * u * L.y + 2 * u * t * c.y + t * t * R.y
        if (distToSegment(mx, my, px, py, qx, qy) < HIT_THRESHOLD()) return true
        px = qx; py = qy
      }
      return false
    }
    case 'measure':
    case 'priceRange':
    case 'dateRange': {
      if (pts.length < 2) return false
      const bx1 = Math.min(pts[0].x, pts[1].x), by1 = Math.min(pts[0].y, pts[1].y)
      const bx2 = Math.max(pts[0].x, pts[1].x), by2 = Math.max(pts[0].y, pts[1].y)
      return mx >= bx1 && mx <= bx2 && my >= by1 && my <= by2
    }
    case 'position': {
      if (pts.length < 3) return false
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
      return mx >= Math.min(...xs) && mx <= Math.max(...xs) && my >= Math.min(...ys) && my <= Math.max(...ys)
    }
    case 'avwap':
      return pts.length >= 1 && Math.hypot(mx - pts[0].x, my - pts[0].y) < HIT_THRESHOLD() * 2
    default: return false
  }
}
