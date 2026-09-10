/* Deterministic pixel geometry for the drawing layer.
 *
 * ⭐ PHASE 0 MOVED THESE BODIES HERE VERBATIM SO THEY COULD BE TESTED; PHASE 1
 * FIXED THE TWO THAT WERE WRONG. What changed, and nothing else did:
 *
 *   • `extendToEdges` / `extendRay` — the ±100px candidate search is gone,
 *     replaced by a Liang–Barsky clip against a real pane RECT. Deterministic,
 *     order-free, and `null` when the line misses (see `clipLineToRect`). Both
 *     now take a rect instead of a bare `w, h`, because "the price pane" is not
 *     expressible as a width and a height.
 *   • `hitTestDrawing` takes the same rect, and tolerates index-stable points
 *     carrying `valid: false` rather than treating a null x as 0.
 *
 * Everything else in this file is still the shipped body, character for
 * character. `drawingGeometry.test.js` executes all of it — which is the whole
 * reason the two fixes above could be made as edits with a failing test in front
 * of them rather than as a rewrite nobody could check.
 *
 * ⛔ NO lightweight-charts IMPORT, EVER. Plain numbers in, plain numbers out is
 * what makes this testable without a chart, and a chart is exactly what jsdom
 * cannot give us.
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
 * Clip the INFINITE line through p1,p2 to a rectangle — Liang–Barsky.
 *
 * ⚰️ WHAT THIS REPLACES, AND WHY THE OLD ONE COULD NOT BE PATCHED.
 * `extendToEdges` computed the line's four possible edge crossings, admitted any
 * that fell within a ±100px SLACK around the box, and returned the first two in
 * PUSH ORDER (left, right, top, bottom). Three consequences, all of them bugs
 * the audit found in the field:
 *
 *   1. the slack let it return points up to 100px OUTSIDE the box, so a "clipped"
 *      line was drawn past the edge it was supposed to stop at;
 *   2. WHICH two crossings won depended on the slope, so a slow zoom flipped the
 *      chosen pair and the segment changed identity mid-gesture — the Pitchfork
 *      "lines jump / skip around" report;
 *   3. the pair had no consistent direction, so two PARALLEL lines could come
 *      back traversed opposite ways. Build a quad from them and it self-
 *      intersects — the Parallel Channel "part of the tint disappears" report.
 *
 * ⭐ LIANG–BARSKY HAS NO CANDIDATES AND NO ORDER. It solves for the parameter
 * interval [t0, t1] along the direction vector p1→p2 for which the point stays
 * inside the rect, then evaluates the endpoints. There is nothing to choose
 * between, so nothing can flip: the answer is a continuous function of the
 * inputs, which is exactly the property zoom and anchor-dragging need. And
 * because t is measured ALONG p1→p2, the returned pair is always ordered
 * low-t → high-t, so parallel lines are always traversed the same way and a band
 * built from two of them can never bow-tie.
 *
 * Returns `null` when the line misses the rect entirely — which is a real answer
 * ("draw nothing"), not a failure. Callers must handle it rather than falling
 * back to the raw anchors, or an off-screen line reappears across the pane.
 */
export function clipLineToRect(p1, p2, rect) {
  if (!p1 || !p2 || !rect) return null
  const { x0, y0, x1, y1 } = rect
  if (!(x1 > x0) || !(y1 > y0)) return null
  const px = p1.x, py = p1.y
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  if (![px, py, dx, dy].every(Number.isFinite)) return null

  // A degenerate "line" is a point: inside → a zero-length segment, outside →
  // nothing. Returning the box diagonal here (which the old code effectively did
  // for dx === 0) is how a collapsed drawing used to sprout a full-height line.
  if (dx === 0 && dy === 0) {
    return (px >= x0 && px <= x1 && py >= y0 && py <= y1) ? [{ x: px, y: py }, { x: px, y: py }] : null
  }

  // Unbounded in both directions: the infinite line, not the segment.
  let t0 = -Infinity, t1 = Infinity
  const clip = (p, q) => {
    if (p === 0) return q >= 0            // parallel to this edge: inside iff q >= 0
    const r = q / p
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r }
    else { if (r < t0) return false; if (r < t1) t1 = r }
    return true
  }
  if (!clip(-dx, px - x0)) return null
  if (!clip(dx, x1 - px)) return null
  if (!clip(-dy, py - y0)) return null
  if (!clip(dy, y1 - py)) return null
  if (!(t0 <= t1) || !Number.isFinite(t0) || !Number.isFinite(t1)) return null

  return [
    { x: px + t0 * dx, y: py + t0 * dy },
    { x: px + t1 * dx, y: py + t1 * dy },
  ]
}

/**
 * Both points where the infinite line through p1,p2 leaves `rect`.
 *
 * Kept as the name every multi-line tool calls, but it is now a thin wrapper
 * over `clipLineToRect` — same determinism, same ordering, and `null` when the
 * line misses. The old `(p1, p2, w, h)` signature is gone on purpose: a bare
 * width/height cannot express "the price pane", and every caller now has a real
 * pane rect to hand it.
 */
export function extendToEdges(p1, p2, rect) {
  return clipLineToRect(p1, p2, rect)
}

/**
 * The line through p1,p2 extended WELL BEYOND `rect`, in the p1 -> p2 direction.
 *
 * ⭐ THIS IS HOW A BAND FILL STOPS LOSING CORNERS. The region between two
 * parallel lines clipped to a rectangle is NOT always a quadrilateral — when the
 * two edges leave through different sides it is a pentagon, and
 * `renderChannel` / `renderPitchfork` filled a 4-gon built from clipped
 * endpoints, so a corner simply went uncovered. Clipping the polygon by hand
 * means re-deriving that case analysis; extending past the rect and letting
 * `ctx.clip()` trim is correct for every case by construction, and canvas has to
 * do the clipping work anyway.
 *
 * Always returns [-k, +k] along p1 -> p2, so two parallel lines are traversed
 * the same way and the quad between them can never self-intersect.
 */
export function extendLineFar(p1, p2, rect) {
  if (!p1 || !p2 || !rect) return null
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  const len = Math.hypot(dx, dy)
  if (!Number.isFinite(len) || len === 0) return null
  // Two diagonals plus a slack — far enough that the extended segment always
  // spans the rect, small enough to stay well inside canvas coordinate precision.
  const reach = Math.hypot(rect.x1 - rect.x0, rect.y1 - rect.y0) * 2 + 1000
  const k = reach / len
  return [
    { x: p1.x - dx * k, y: p1.y - dy * k },
    { x: p1.x + dx * k, y: p1.y + dy * k },
  ]
}

/**
 * A RAY: anchored at p1, extended through p2 to the edge of `rect`.
 *
 * ⭐ THE ORDERING GUARANTEE FROM `clipLineToRect` IS WHAT MAKES THIS TRIVIAL.
 * t is measured along p1→p2, so the far end is simply the larger t — no dot
 * products, no "pick the edge on the p2 side", and no way for the two to
 * disagree. The old version compared dot products against a pair whose order was
 * itself unstable.
 *
 * Returns `null` when the ray is entirely outside the rect. When p1 is outside
 * but the ray crosses the rect, the visible part is returned — which is correct
 * and is what lets a ray anchored off-screen still draw where it should.
 */
export function extendRay(p1, p2, rect) {
  if (!p1 || !p2) return null
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  if (dx === 0 && dy === 0) return null
  const seg = clipLineToRect(p1, p2, rect)
  if (!seg) return null
  // `clipLineToRect` returns [t0, t1] with t0 <= t1 along p1 -> p2, so tB is the
  // far end by construction. Recover t from whichever component is larger, so a
  // near-axis-aligned ray never divides by ~0.
  const tOf = (q) => (Math.abs(dx) >= Math.abs(dy) ? (q.x - p1.x) / dx : (q.y - p1.y) / dy)
  const tA = tOf(seg[0]), tB = tOf(seg[1])
  if (tB <= 0) return null            // the visible span is entirely behind the anchor
  // tA < 0 means the anchor itself is inside the rect (t = 0 lies within the
  // visible span), so the ray starts exactly where the user put it.
  return [tA >= 0 ? seg[0] : { x: p1.x, y: p1.y }, seg[1]]
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
  const m = computeAdvanceMove(A, B)
  return m ? m.pct : null
}

/**
 * The full run between two candles: where it started, where it ended, the
 * amount and the percentage.
 *
 * ⭐ ONE FUNCTION SO THE DOLLAR AND THE PERCENT CANNOT DESCRIBE DIFFERENT MOVES.
 * A run is measured low→high when price advanced and high→low when it fell —
 * the extremes of the move, not the closes — so deriving a dollar figure from
 * the two anchors' own prices instead would print an amount and a percentage
 * that disagree about what was measured. `computeAdvancePct` now delegates here,
 * so the percentage every existing label shows is byte-for-byte the one it
 * showed before.
 */
export function computeAdvanceMove(A, B) {
  if (!A || !B) return null
  const aHi = A.h, aLo = A.l, bHi = B.h, bLo = B.l
  if ([aHi, aLo, bHi, bLo].some(v => v == null)) return null
  const isDecline = (bHi + bLo) < (aHi + aLo)   // B lower than A on average
  const from = isDecline ? aHi : aLo
  const to = isDecline ? bLo : bHi
  if (!(from > 0)) return null
  return { from, to, delta: to - from, pct: (to - from) / from * 100, isDecline }
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

/**
 * Are the first `n` resolved points usable — and usable FOR WHAT?
 *
 * Index-stable resolution keeps a slot for every stored anchor and marks the
 * unresolvable ones, so a painter must ask rather than assume: a point whose x
 * could not be mapped used to numeric-coerce to 0 and drag the whole drawing to
 * the chart's left edge.
 *
 * ⛔ BUT "USABLE" IS PER AXIS, AND GETTING THAT WRONG DELETES A TOOL.
 * ⚰️ CAUGHT IN-BROWSER: a Horizontal Line is stored as `{ price }` with NO
 * `time` — it is a price LEVEL, it has no x and never needed one, and the
 * renderer spans the pane rect rather than reading `p.x`. A blanket
 * "both coordinates must be finite" made every horizontal line invalid, and they
 * all silently stopped rendering. The mirror case is the Vertical Line, which is
 * a time marker with no meaningful price.
 *
 * `axis` says which coordinates this call actually depends on:
 *   'both' (default) · 'x' (vertical) · 'y' (horizontal)
 */
export const pointsUsable = (pts, n, axis = 'both') => {
  if (!pts || pts.length < n) return false
  const needX = axis !== 'y'
  const needY = axis !== 'x'
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    if (!p) return false
    if (needX && !Number.isFinite(p.x)) return false
    if (needY && !Number.isFinite(p.y)) return false
  }
  return true
}

/**
 * @param {object} d      the drawing
 * @param {object[]} pts  index-stable resolved points
 * @param {number} mx
 * @param {number} my
 * @param {object} rect   the drawing's PANE rect — a click outside it is not a
 *                        hit, which is what stops an invisible (clipped) part of
 *                        a drawing still swallowing clicks in the other pane.
 */
const ok = pointsUsable

export function hitTestDrawing(d, pts, mx, my, rect, box = null) {
  if (!pts.length || !rect) return false
  // ⛔ THE CLIP AND THE HIT TEST MUST AGREE. Phase 1 clips a drawing to its pane;
  // if hit-testing did not, a price trendline would keep stealing clicks from the
  // volume pane it can no longer be seen in — the classic invisible-hitbox bug.
  if (mx < rect.x0 || mx > rect.x1 || my < rect.y0 || my > rect.y1) return false
  const w = rect.x1
  switch (d.type) {
    case 'trendline':
      return ok(pts, 2) && distToSegment(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD()
    case 'ray': {
      if (!ok(pts, 2)) return false
      const seg = extendRay(pts[0], pts[1], rect)
      if (!seg) return false
      return distToSegment(mx, my, seg[0].x, seg[0].y, seg[1].x, seg[1].y) < HIT_THRESHOLD()
    }
    case 'extended': {
      if (!ok(pts, 2)) return false
      return distToLine(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD()
    }
    case 'horizontal':
      // y only: a price level has no time and needs no x.
      return ok(pts, 1, 'y') && Math.abs(my - pts[0].y) < HIT_THRESHOLD()
    case 'hray':
      return ok(pts, 1) && Math.abs(my - pts[0].y) < HIT_THRESHOLD() && mx >= pts[0].x - HIT_THRESHOLD()
    case 'vertical':
      // x only: a time marker needs no price.
      return ok(pts, 1, 'x') && Math.abs(mx - pts[0].x) < HIT_THRESHOLD()
    case 'rect':
    case 'circle': {
      if (!ok(pts, 2)) return false
      const x1 = Math.min(pts[0].x, pts[1].x) - HIT_THRESHOLD()
      const y1 = Math.min(pts[0].y, pts[1].y) - HIT_THRESHOLD()
      const x2 = Math.max(pts[0].x, pts[1].x) + HIT_THRESHOLD()
      const y2 = Math.max(pts[0].y, pts[1].y) + HIT_THRESHOLD()
      return mx >= x1 && mx <= x2 && my >= y1 && my <= y2
    }
    case 'arrow':
      return ok(pts, 2) && distToSegment(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD()
    case 'text': {
      if (!ok(pts, 1)) return false
      // ⭐ THE BOX THE PAINTER ACTUALLY DREW, when the caller has it.
      //
      // ⚰️ The estimate below guessed the line count from
      // `para.length * fs * 0.55` ("~avg char width") — wrong for any face that
      // is not the one it assumed, wrong for bold, wrong for a wrapped
      // paragraph, and wrong for one long word. It was the only thing between a
      // click and the right note. `renderText` now publishes its box and the
      // overlay passes it in; this stays as the answer for a caller that has
      // not painted yet.
      if (box) return pointInBox(box, mx, my, HIT_THRESHOLD() - 4)
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
      if (!p || p.valid === false || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false
      return mx >= p.x - 26 && mx <= p.x + 26 && my >= p.y - 70 && my <= p.y + 10
    }
    case 'fib':
    case 'fibext':
      if (!ok(pts, 2)) return false
      return mx >= rect.x0 && mx <= w && (Math.abs(my - pts[0].y) < HIT_THRESHOLD() * 2 || Math.abs(my - pts[1].y) < HIT_THRESHOLD() * 2)
    // ⭐ BOTH MULTI-LINE TOOLS HIT-TEST THE SEGMENTS THAT WERE ACTUALLY DRAWN.
    //
    // They used to measure against the INFINITE line through their anchors, which
    // was wrong in two directions once Phase 1 started clipping:
    //   • a line that does not cross this pane draws nothing, yet the infinite
    //     line could still pass within the grab radius of a corner — an invisible
    //     hitbox in empty space, which is the one outcome the clipping work must
    //     not introduce;
    //   • only ONE of each tool's lines was tested at all (the pitchfork's median,
    //     the channel's first boundary), so the other visible lines could be seen
    //     and not selected.
    // `extendToEdges` returns exactly what the renderer draws, so asking it here
    // makes "what I can click" and "what I can see" the same set by construction.
    case 'pitchfork': {
      if (!ok(pts, 3)) return false
      const [p1, p2, p3] = pts
      const mid = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 }
      const d = { x: mid.x - p1.x, y: mid.y - p1.y }
      const along = (q) => ({ x: q.x + d.x, y: q.y + d.y })
      const grab = HIT_THRESHOLD() * 2
      for (const seg of [
        extendToEdges(p1, mid, rect),          // median
        extendToEdges(p2, along(p2), rect),    // upper prong
        extendToEdges(p3, along(p3), rect),    // lower prong
      ]) {
        if (seg && distToSegment(mx, my, seg[0].x, seg[0].y, seg[1].x, seg[1].y) < grab) return true
      }
      // The handle bar joins the two shoulders and is drawn between the raw
      // anchors, so it is a plain segment.
      return distToSegment(mx, my, p2.x, p2.y, p3.x, p3.y) < grab
    }
    case 'channel': {
      if (!ok(pts, 2)) return false
      const grab = HIT_THRESHOLD() * 2
      const first = extendToEdges(pts[0], pts[1], rect)
      if (first && distToSegment(mx, my, first[0].x, first[0].y, first[1].x, first[1].y) < grab) return true
      if (!ok(pts, 3)) return false
      const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y
      const second = extendToEdges(pts[2], { x: pts[2].x + dx, y: pts[2].y + dy }, rect)
      return !!second && distToSegment(mx, my, second[0].x, second[0].y, second[1].x, second[1].y) < grab
    }
    case 'cup': {
      if (!ok(pts, 3)) return ok(pts, 2) && distToSegment(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD()
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
    case 'priceRange': {
      if (!ok(pts, 2)) return false
      const bx1 = Math.min(pts[0].x, pts[1].x), by1 = Math.min(pts[0].y, pts[1].y)
      const bx2 = Math.max(pts[0].x, pts[1].x), by2 = Math.max(pts[0].y, pts[1].y)
      return mx >= bx1 && mx <= bx2 && my >= by1 && my <= by2
    }
    // ⛔ BARS & TIME IS GRABBED BY ITS RULE, NOT BY A BOX. It shares a stored
    // shape with Measure but not a silhouette: it paints a single horizontal
    // span, so a rectangular hitbox between the two anchors would swallow every
    // click in a tall empty region the tool does not occupy — the invisible
    // hitbox this layer spent Phase 1 removing. A legacy `dateRange` whose two
    // anchors differ in price is handled by reading `pts[0].y` for the row,
    // exactly as the painter does.
    case 'dateRange': {
      if (!ok(pts, 2)) return false
      const y = pts[0].y
      const xa = Math.min(pts[0].x, pts[1].x), xb = Math.max(pts[0].x, pts[1].x)
      const t = HIT_THRESHOLD()
      return mx >= xa - t && mx <= xb + t && Math.abs(my - y) < t + 5
    }
    case 'position': {
      if (!ok(pts, 3)) return false
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
      return mx >= Math.min(...xs) && mx <= Math.max(...xs) && my >= Math.min(...ys) && my <= Math.max(...ys)
    }
    case 'avwap':
      return ok(pts, 1) && Math.hypot(mx - pts[0].x, my - pts[0].y) < HIT_THRESHOLD() * 2
    default: return false
  }
}

// ─── Where a tool's HANDLES go (Phase 4) ────────────────────────

/**
 * ⭐ A HANDLE IS NOT ALWAYS AN ANCHOR, AND THE CIRCLE IS WHY.
 *
 * A Circle stores two points — opposite corners of the ellipse's bounding box —
 * and the ellipse is inscribed in that box. So the anchors themselves sit in
 * EMPTY SPACE, diagonally outside the shape, and the two gold dots floated off
 * the drawing with nothing under them. `handlePointsFor` is the seam: every
 * other tool's handles are still exactly its anchors, and a tool that wants them
 * somewhere else says so in one place that the painter, the hit test and the
 * cursor all read.
 *
 * ⛔ THE STORED MODEL DOES NOT CHANGE. This maps anchors → pixels for DISPLAY and
 * HIT TESTING only. Index `i` of the result is still anchor `i`, which is what
 * `handleIdx` means to the drag path, so dragging goes on moving the same stored
 * corner it always did.
 */

/** Where the segment centre→corner crosses the inscribed ellipse.
 *
 *  In normalised ellipse space a bbox corner sits at (±1, ±1), so the ray from
 *  the centre through it meets the ellipse at (±1/√2, ±1/√2) — the point of the
 *  border facing its own corner. Symmetric, one per anchor, and it degenerates
 *  gracefully: a zero-width ellipse puts both handles on the vertical it drew. */
const DIAG = Math.SQRT1_2

export function circleHandlePoints(pts) {
  if (!pts || pts.length < 2 || !pts[0] || !pts[1]) return pts || []
  const a = pts[0], b = pts[1]
  if (a.valid === false || b.valid === false) return pts
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return pts
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
  const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2
  const on = (p) => ({
    ...p,
    x: cx + Math.sign(p.x - cx) * rx * DIAG,
    y: cy + Math.sign(p.y - cy) * ry * DIAG,
  })
  return [on(a), on(b), ...pts.slice(2)]
}

/**
 * How far the ANCHOR must move for the HANDLE to keep up with the cursor.
 *
 * ⛔ WITHOUT THIS THE HANDLE SLIDES OUT FROM UNDER THE POINTER. A circle handle
 * is `α·own + (1−α)·other` with α = (1 + 1/√2)/2 ≈ 0.854, so moving the anchor
 * by δ moves the visible dot by only 0.854δ — drag it 200px and the dot is 29px
 * behind the mouse. Scaling the drag delta by 1/α makes the dot travel exactly
 * with the pointer while the STORED anchor still moves by a plain delta.
 *
 * ⭐ IT IS 1 FOR EVERY OTHER TOOL AND FOR WHOLE-BODY MOVES. A handle that IS its
 * anchor needs no correction, and a body drag moves both anchors together (so
 * the shape translates rigidly and every handle already tracks 1:1).
 */
export const CIRCLE_HANDLE_GAIN = 1 / ((1 + Math.SQRT1_2) / 2)

export function handleDragGain(type, handleIdx) {
  if (handleIdx == null) return 1
  if (type === 'circle' && (handleIdx === 0 || handleIdx === 1)) return CIRCLE_HANDLE_GAIN
  return 1
}

export function handlePointsFor(type, pts) {
  if (type === 'circle') return circleHandlePoints(pts)
  return pts
}

/**
 * The invariant a tool's stored points must satisfy, applied after any edit.
 *
 * ⭐ A CONSTRAINT BELONGS TO THE SHAPE, NOT TO THE GESTURE. Bars & Time is
 * horizontal by definition — that is what makes it a duration ruler rather than
 * a trend line with numbers on it. Enforcing that in the drag handler alone
 * would leave four other doors open (paste, duplicate, "set level", a drawing
 * arriving from an older client), and each would need to remember. Stating it
 * once, here, and running it wherever points are written means the shape cannot
 * be tilted by any route.
 *
 * ⛔ THE FIRST ANCHOR WINS, AND THAT MAKES BOTH HANDLES BEHAVE. Dragging the
 * left cap moves the row and the right cap follows; dragging the right cap
 * changes only the span and cannot tilt it. Whatever vertical anchor the point
 * carries is copied wholesale — `price` for a price-pane drawing, `paneY` for
 * one living among the volume bars — so a ruler in the volume pane stays level
 * there too.
 *
 * Returns the SAME array when nothing needed changing, so callers can use it as
 * a cheap no-op on every other tool.
 */
export function constrainPoints(type, points) {
  if (type !== 'dateRange') return points
  const pts = points || []
  if (pts.length < 2 || !pts[0] || !pts[1]) return points
  const a = pts[0], b = pts[1]
  const same = a.price === b.price && a.paneY === b.paneY && a.paneRelY === b.paneRelY
  if (same) return points
  const out = pts.slice()
  out[1] = { ...b, price: a.price, paneY: a.paneY ?? null, paneRelY: a.paneRelY ?? null }
  return out
}

/** Is this point inside a label box? Used where the visible object is a label
 *  and the anchors are data — see Price Move. */
export function pointInBox(box, mx, my, pad = 0) {
  if (!box) return false
  return mx >= box.x - pad && mx <= box.x + box.w + pad
    && my >= box.y - pad && my <= box.y + box.h + pad
}
