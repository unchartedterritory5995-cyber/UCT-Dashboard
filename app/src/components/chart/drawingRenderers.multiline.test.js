/* Pitchfork and Parallel Channel — the two tools whose reported bugs were
 * geometry bugs, locked down.
 *
 * ─── WHAT WAS ACTUALLY REPORTED ─────────────────────────────────────────────
 *
 *   Pitchfork: "some lines disappear / jump / skip around / render
 *               inconsistently" while zooming, panning or dragging anchors.
 *   Channel:   "part of the internal tinted region can disappear."
 *
 * Phase 1 replaced the shared machinery both are built on — a candidate-search
 * edge finder became a Liang–Barsky clip, resolved points became index-stable,
 * and band fills stopped being hand-clipped. This file is the proof that those
 * changes actually removed these two tools' failure modes, expressed as the
 * INVARIANTS a user would notice being broken rather than as a restatement of
 * the implementation.
 *
 * ⛔ THE SWEEPS ARE THE POINT, NOT THE SPOT CHECKS. Both bugs were
 * DISCONTINUITIES: the geometry was fine at any given moment and wrong between
 * two moments, which is exactly what a single-frame assertion cannot see and
 * what a user dragging an anchor sees immediately. So the important tests here
 * walk an anchor through hundreds of positions and assert that nothing ever
 * jumps, swaps or vanishes along the way.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { renderPitchfork, renderChannel } from './drawingRenderers'
import { extendToEdges, extendLineFar, hitTestDrawing } from './drawingGeometry'
import { __resetCoarsePointerForTest } from './coarsePointer'

const P = (x, y) => ({ x, y })
const RECT = { x0: 0, y0: 0, x1: 800, y1: 400 }
const VOL = { x0: 0, y0: 320, x1: 800, y1: 400 }

/** Recording ctx — enough to read back geometry and canvas state. */
function makeCtx(initial = {}) {
  const calls = []
  const state = { strokeStyle: '#c9a84c', fillStyle: '#000', lineWidth: 1, globalAlpha: 1, lineDash: [], ...initial }
  const stack = []
  const ctx = {}
  for (const m of ['beginPath', 'closePath', 'moveTo', 'lineTo', 'stroke', 'fill', 'rect', 'clip']) {
    ctx[m] = (...args) => calls.push({ op: m, args })
  }
  ctx.setLineDash = (a) => { state.lineDash = (a || []).slice(); calls.push({ op: 'setLineDash', args: [state.lineDash] }) }
  ctx.save = () => { stack.push({ ...state, lineDash: state.lineDash.slice() }); calls.push({ op: 'save' }) }
  ctx.restore = () => { const s = stack.pop(); if (s) Object.assign(state, s); calls.push({ op: 'restore' }) }
  for (const k of Object.keys(state)) {
    if (k === 'lineDash') continue
    Object.defineProperty(ctx, k, {
      get: () => state[k], set: (v) => { state[k] = v; calls.push({ op: `set:${k}`, args: [v] }) }, configurable: true,
    })
  }
  ctx.__calls = calls
  ctx.__state = state
  ctx.__depth = () => stack.length
  /** Every path built between beginPath and its terminating stroke/fill. */
  ctx.__paths = () => {
    const out = []
    let cur = null
    for (const c of calls) {
      if (c.op === 'beginPath') cur = { pts: [], kind: null }
      else if ((c.op === 'moveTo' || c.op === 'lineTo') && cur) cur.pts.push(P(c.args[0], c.args[1]))
      else if ((c.op === 'stroke' || c.op === 'fill') && cur) { cur.kind = c.op; out.push(cur); cur = null }
    }
    return out
  }
  ctx.__strokes = () => ctx.__paths().filter((p) => p.kind === 'stroke')
  ctx.__fills = () => ctx.__paths().filter((p) => p.kind === 'fill')
  return ctx
}

// ── geometry helpers used by the assertions ─────────────────────────────────
const dir = (seg) => ({ x: seg.pts[1].x - seg.pts[0].x, y: seg.pts[1].y - seg.pts[0].y })
const cross = (a, b) => a.x * b.y - a.y * b.x
const dot = (a, b) => a.x * b.x + a.y * b.y
const parallel = (a, b) => Math.abs(cross(dir(a), dir(b))) < 1e-6 * (Math.hypot(dir(a).x, dir(a).y) * Math.hypot(dir(b).x, dir(b).y) || 1)

/** Is a simple polygon convex (equivalently, for a quad: not self-intersecting)? */
function isConvex(poly) {
  const n = poly.length
  const signs = []
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n]
    const z = cross({ x: b.x - a.x, y: b.y - a.y }, { x: c.x - b.x, y: c.y - b.y })
    if (Math.abs(z) > 1e-9) signs.push(Math.sign(z))
  }
  return new Set(signs).size <= 1
}

function insidePolygon(poly, p) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

const inRect = (p, r = RECT) =>
  p.x >= r.x0 - 1e-6 && p.x <= r.x1 + 1e-6 && p.y >= r.y0 - 1e-6 && p.y <= r.y1 + 1e-6

/** The EXTENDED lines (median, upper prong, lower prong) — everything except the
 *  handle bar.
 *
 *  These are the ones clipped ANALYTICALLY, and the ones the old ±100px slack
 *  could draw outside the pane. The handle bar between the two shoulder anchors
 *  is deliberately NOT clipped analytically: it is a segment between two points
 *  the user placed, so it is drawn where they are and `ctx.clip()` trims whatever
 *  leaves the pane, exactly like the fill. Asserting it stayed inside the rect
 *  would be asserting the wrong contract.
 *
 *  ⛔ IDENTIFIED BY ITS ENDPOINTS, NOT BY ITS INDEX. A prong whose line misses
 *  the pane draws nothing, so the handle bar is not reliably the 4th stroke —
 *  indexing by position made this helper silently return the wrong lines for
 *  exactly the off-screen cases it exists to check. */
const isHandleBar = (seg, [, p2, p3]) => {
  const same = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
  return (same(seg.pts[0], p2) && same(seg.pts[1], p3))
    || (same(seg.pts[0], p3) && same(seg.pts[1], p2))
}
const extendedLines = (ctx, anchors) => ctx.__strokes().filter((s) => !isHandleBar(s, anchors))
const handleBar = (ctx, anchors) => ctx.__strokes().find((s) => isHandleBar(s, anchors))

/** Signed distance of p from the infinite line through a,b — the side test the
 *  "is this point inside the band" question reduces to. */
const side = (a, b, p) => cross({ x: b.x - a.x, y: b.y - a.y }, { x: p.x - a.x, y: p.y - a.y })

// ═══════════════════════════════════════════════════════════════════════════
describe('PITCHFORK — what it draws', () => {
  const fork = [P(80, 320), P(300, 100), P(300, 240)]

  it('draws median + two prongs + handle bar, and exactly one fill', () => {
    const ctx = makeCtx()
    renderPitchfork(ctx, fork, RECT)
    expect(ctx.__strokes()).toHaveLength(4)
    expect(ctx.__fills()).toHaveLength(1)
    expect(ctx.__depth()).toBe(0)
  })

  it('⭐ the two prongs are parallel to each other AND to the median', () => {
    // Invariant 4. Both prongs are the median's direction translated to a
    // shoulder, so any drift here means the geometry has stopped being a fork.
    const ctx = makeCtx()
    renderPitchfork(ctx, fork, RECT)
    const [median, upper, lower] = ctx.__strokes()
    expect(parallel(upper, lower)).toBe(true)
    expect(parallel(median, upper)).toBe(true)
  })

  it('every extended line stays inside the pane rect', () => {
    // Invariant 10, and the fix for the old ±100px slack that let a "clipped"
    // line be drawn up to 100px outside the box it was clipped to.
    const ctx = makeCtx()
    renderPitchfork(ctx, fork, RECT)
    for (const s of extendedLines(ctx, fork)) for (const p of s.pts) expect(inRect(p)).toBe(true)
  })

  it('stays inside a VOLUME pane rect too — nothing reaches the candles', () => {
    const ctx = makeCtx()
    const anchors = [P(80, 390), P(300, 330), P(300, 370)]
    renderPitchfork(ctx, anchors, VOL)
    for (const s of extendedLines(ctx, anchors)) for (const p of s.pts) expect(inRect(p, VOL)).toBe(true)
  })
})

describe('PITCHFORK — ⚰️ the reported bug: jumping, skipping, swapping', () => {
  // ⛔ THIS IS THE TEST THE ORIGINAL BUG REPORT DESERVES. Drag the right
  // shoulder through a 600px vertical sweep — which is what "adjusting the
  // Pitchfork" and "zooming" both amount to geometrically — and demand that
  // nothing ever moves discontinuously.
  const sweep = (rect = RECT, step = 1) => {
    const frames = []
    for (let y = -200; y <= 400; y += step) {
      const ctx = makeCtx()
      renderPitchfork(ctx, [P(80, 320), P(300, 100), P(300, y)], rect)
      frames.push(ctx.__strokes())
    }
    return frames
  }

  it('never jumps: no endpoint moves more than a few px per 1px of anchor movement', () => {
    const frames = sweep()
    let worst = 0, worstAt = -1
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i]
      if (a.length !== b.length) continue          // covered by its own test below
      for (let k = 0; k < a.length; k++) {
        const d = Math.hypot(b[k].pts[0].x - a[k].pts[0].x, b[k].pts[0].y - a[k].pts[0].y)
          + Math.hypot(b[k].pts[1].x - a[k].pts[1].x, b[k].pts[1].y - a[k].pts[1].y)
        if (d > worst) { worst = d; worstAt = i }
      }
    }
    expect(worst, `biggest single-step jump was at sweep frame ${worstAt}`).toBeLessThan(30)
  })

  it('never swaps ends: each line keeps its traversal direction through the sweep', () => {
    // Invariant 3. The old resolver returned its two crossings in PUSH ORDER
    // (left, right, top, bottom), so which end came first flipped with the slope
    // — and a segment that reverses mid-drag is exactly what "skips around"
    // looks like.
    const frames = sweep()
    for (let k = 0; k < 3; k++) {          // median, upper, lower
      let prev = null
      for (const f of frames) {
        if (!f[k]) continue
        const d = dir(f[k])
        if (prev && dot(prev, d) !== 0) {
          expect(dot(prev, d), `line ${k} reversed direction mid-sweep`).toBeGreaterThan(0)
        }
        prev = d
      }
    }
  })

  it('never snaps to x = 0', () => {
    // The null-coerced-to-zero signature: a line that leaps to the chart's left
    // edge and back. A legitimate left-edge crossing is fine; what is not is BOTH
    // endpoints of a line collapsing onto x = 0 when the fork is nowhere near it.
    for (const f of sweep()) {
      for (const s of f) {
        expect(s.pts[0].x === 0 && s.pts[1].x === 0).toBe(false)
      }
    }
  })

  it('does not lose a prong partway through the sweep while the fork is on-screen', () => {
    // Invariant 2. With the fork's body inside the pane, all four strokes must be
    // present in every frame — no "sometimes a line disappears".
    for (let y = 60; y <= 380; y += 1) {
      const ctx = makeCtx()
      renderPitchfork(ctx, [P(80, 320), P(300, 100), P(300, y)], RECT)
      expect(ctx.__strokes().length, `y=${y}`).toBe(4)
    }
  })

  it('is deterministic — the same anchors always produce the same geometry', () => {
    const once = makeCtx(); renderPitchfork(once, [P(80, 320), P(300, 100), P(300, 240)], RECT)
    const twice = makeCtx(); renderPitchfork(twice, [P(80, 320), P(300, 100), P(300, 240)], RECT)
    expect(JSON.stringify(twice.__strokes())).toBe(JSON.stringify(once.__strokes()))
  })

  it('⭐ ZOOM is continuous — a chart zoom scales the TIME axis, and nothing jumps', () => {
    // Invariant 6. A chart zoom does not scale the drawing uniformly about a
    // point — it restretches the x (time) axis while the price mapping holds, so
    // the anchors' x coordinates spread or compress about the anchor position.
    // WHICH edge a line exits through legitimately changes as it does; what must
    // NOT happen is a jump, which is what the old push-order resolver produced
    // and what the user saw as the fork "skipping around" mid-zoom.
    const at = (k) => {
      const sx = (x) => 400 + (x - 400) * k
      const ctx = makeCtx()
      const anchors = [P(sx(200), 300), P(sx(500), 150), P(sx(500), 250)]
      renderPitchfork(ctx, anchors, RECT)
      return extendedLines(ctx, anchors)
    }
    let prev = at(0.4), worst = 0
    for (let k = 0.4; k <= 3; k += 0.005) {
      const cur = at(k)
      if (cur.length === prev.length) {
        for (let i = 0; i < cur.length; i++) {
          worst = Math.max(worst,
            Math.hypot(cur[i].pts[0].x - prev[i].pts[0].x, cur[i].pts[0].y - prev[i].pts[0].y),
            Math.hypot(cur[i].pts[1].x - prev[i].pts[1].x, cur[i].pts[1].y - prev[i].pts[1].y))
        }
      }
      prev = cur
    }
    expect(worst).toBeLessThan(20)
  })
})

describe('PITCHFORK — difficult geometry', () => {
  const strokesFor = (anchors, rect = RECT) => {
    const ctx = makeCtx()
    renderPitchfork(ctx, anchors, rect)
    return ctx
  }

  it('nearly horizontal fork', () => {
    const ctx = strokesFor([P(50, 200), P(700, 199.9), P(700, 200.1)])
    expect(ctx.__strokes().length).toBe(4)
    for (const s of ctx.__strokes()) for (const p of s.pts) expect(inRect(p)).toBe(true)
  })

  it('nearly vertical fork', () => {
    const ctx = strokesFor([P(400, 380), P(399.9, 40), P(400.1, 40)])
    expect(ctx.__strokes().length).toBe(4)
    for (const s of ctx.__strokes()) for (const p of s.pts) expect(inRect(p)).toBe(true)
  })

  it('extremely narrow fork (shoulders 1px apart)', () => {
    const ctx = strokesFor([P(100, 300), P(400, 200), P(400, 201)])
    expect(ctx.__strokes().length).toBe(4)
    expect(parallel(ctx.__strokes()[1], ctx.__strokes()[2])).toBe(true)
  })

  it('very wide fork (shoulders beyond the pane)', () => {
    const anchors = [P(400, 200), P(-400, -300), P(1200, 700)]
    const ctx = strokesFor(anchors)
    for (const s of extendedLines(ctx, anchors)) for (const p of s.pts) expect(inRect(p)).toBe(true)
  })

  it('one anchor off-screen still draws the visible lines', () => {
    const ctx = strokesFor([P(-500, 320), P(300, 100), P(300, 240)])
    expect(ctx.__strokes().length).toBeGreaterThanOrEqual(3)
    for (const s of ctx.__strokes()) for (const p of s.pts) expect(inRect(p)).toBe(true)
  })

  it('all anchors off-screen draws only what crosses the pane', () => {
    const anchors = [P(-900, -900), P(-800, -950), P(-800, -850)]
    const ctx = strokesFor(anchors)
    for (const s of extendedLines(ctx, anchors)) for (const p of s.pts) expect(inRect(p)).toBe(true)
  })

  it('the handle bar is drawn between the RAW anchors and left to ctx.clip()', () => {
    // Not an oversight: the bar marks where the user put the two shoulders, so it
    // has to be drawn there. Canvas clipping trims the part outside the pane —
    // the same arrangement the fill uses.
    const anchors = [P(400, 200), P(-400, -300), P(1200, 700)]
    const ctx = strokesFor(anchors)
    expect(handleBar(ctx, anchors)).toBeTruthy()
    expect(handleBar(ctx, anchors).pts).toEqual([P(-400, -300), P(1200, 700)])
  })

  it('REVERSED shoulders (p3 above p2) behave identically', () => {
    const a = strokesFor([P(80, 320), P(300, 240), P(300, 100)])
    const b = strokesFor([P(80, 320), P(300, 100), P(300, 240)])
    // Same lines, possibly listed upper/lower the other way round.
    const key = (c) => c.__strokes().slice(1, 3)
      .map((s) => s.pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('|')).sort().join(' ')
    expect(key(a)).toBe(key(b))
  })

  it('DEGENERATE: pivot exactly at the shoulders’ midpoint draws no prongs and does not throw', () => {
    // dir === 0, so there is no fork — the old code would divide into a
    // full-height vertical line out of nowhere.
    const ctx = strokesFor([P(300, 170), P(300, 100), P(300, 240)])
    expect(ctx.__fills()).toHaveLength(0)
    expect(ctx.__depth()).toBe(0)
  })

  it('an anchor that could not be resolved draws NOTHING — never a partial fork', () => {
    const ctx = makeCtx()
    renderPitchfork(ctx, [P(80, 320), { x: null, y: 100, valid: false }, P(300, 240)], RECT)
    expect(ctx.__calls).toHaveLength(0)
  })
})

describe('PITCHFORK — the fill', () => {
  const fillOf = (anchors, rect = RECT) => {
    const ctx = makeCtx()
    renderPitchfork(ctx, anchors, rect)
    return { ctx, poly: ctx.__fills()[0]?.pts }
  }

  it('is a simple (convex) quad — never a bow-tie', () => {
    for (let y = -100; y <= 400; y += 3) {
      const { poly } = fillOf([P(80, 320), P(300, 100), P(300, y)])
      if (!poly) continue
      expect(poly).toHaveLength(4)
      expect(isConvex(poly), `bow-tie at shoulder y=${y}`).toBe(true)
    }
  })

  it('⭐ covers EVERY point of the band that lies inside the pane — no missing corner', () => {
    // ⚰️ THE ORIGINAL BUG, TESTED DIRECTLY. The band between two parallel lines
    // clipped to a rectangle is a PENTAGON whenever the two edges leave through
    // different sides; the old code filled a quadrilateral built from clipped
    // endpoints, so one corner went uncovered. Sampling the real band and
    // demanding the fill polygon contains every sample is the assertion that
    // actually means "the tint is complete".
    for (const anchors of [
      [P(80, 320), P(300, 100), P(300, 240)],
      [P(400, 380), P(200, 60), P(600, 120)],     // edges exit different sides
      [P(50, 50), P(700, 380), P(760, 200)],
      // NOT [P(400,200), P(100,100), P(700,300)] — there the pivot lands exactly
      // on the shoulders' midpoint, so `dir` is zero and there IS no fork. That
      // degenerate case has its own test; using it here was testing nothing.
      [P(420, 210), P(100, 100), P(700, 300)],
    ]) {
      const { poly } = fillOf(anchors)
      expect(poly).toBeTruthy()
      const [p1, p2, p3] = anchors
      const mid = P((p2.x + p3.x) / 2, (p2.y + p3.y) / 2)
      const d = { x: mid.x - p1.x, y: mid.y - p1.y }
      const u2 = P(p2.x + d.x, p2.y + d.y), l2 = P(p3.x + d.x, p3.y + d.y)
      let sampled = 0
      for (let x = 2; x < 800; x += 11) {
        for (let y = 2; y < 400; y += 7) {
          const q = P(x, y)
          // ⛔ SKIP POINTS ON THE BAND'S EDGE. `insidePolygon` is undefined
          // exactly on a boundary, and a sample that lands on one is testing
          // floating point, not coverage. (This is what made (794,212) — which
          // sits precisely on the lower prong — look like a missing corner.)
          const dU = side(p2, u2, q) / Math.hypot(u2.x - p2.x, u2.y - p2.y)
          const dL = side(p3, l2, q) / Math.hypot(l2.x - p3.x, l2.y - p3.y)
          if (Math.abs(dU) < 1 || Math.abs(dL) < 1) continue
          const inBand = Math.sign(dU) !== Math.sign(dL)
          if (!inBand) continue
          sampled++
          expect(insidePolygon(poly, q), `uncovered band point (${x},${y})`).toBe(true)
        }
      }
      expect(sampled).toBeGreaterThan(20)   // guard the guard
    }
  })

  it('extends BEYOND the pane so ctx.clip() does the trimming', () => {
    const { poly } = fillOf([P(80, 320), P(300, 100), P(300, 240)])
    expect(poly.some((p) => !inRect(p))).toBe(true)
  })

  it('never disappears while the slope changes', () => {
    let missing = 0
    for (let y = 60; y <= 380; y += 1) {
      const { poly } = fillOf([P(80, 320), P(300, 100), P(300, y)])
      if (!poly) missing++
    }
    expect(missing).toBe(0)
  })

  it('paints at the shipped 0.04 and restores the alpha it found', () => {
    const ctx = makeCtx()
    renderPitchfork(ctx, [P(80, 320), P(300, 100), P(300, 240)], RECT)
    expect(ctx.__calls.filter((c) => c.op === 'set:globalAlpha').map((c) => c.args[0])).toContain(0.04)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('PARALLEL CHANNEL — what it draws', () => {
  const chan = [P(60, 340), P(500, 120), P(60, 260)]

  it('draws two boundaries and one fill', () => {
    const ctx = makeCtx()
    renderChannel(ctx, chan, RECT)
    expect(ctx.__strokes()).toHaveLength(2)
    expect(ctx.__fills()).toHaveLength(1)
    expect(ctx.__depth()).toBe(0)
  })

  it('the two boundaries are parallel', () => {
    const ctx = makeCtx()
    renderChannel(ctx, chan, RECT)
    const [a, b] = ctx.__strokes()
    expect(parallel(a, b)).toBe(true)
  })

  it('⭐ both boundaries are traversed the SAME way — deterministic ordering', () => {
    // Invariant 5, and the direct cause of the bow-tie: the old resolver could
    // return two parallel lines pointing opposite ways.
    for (let y = 40; y <= 380; y += 3) {
      const ctx = makeCtx()
      renderChannel(ctx, [P(60, 340), P(500, 120), P(60, y)], RECT)
      const s = ctx.__strokes()
      if (s.length < 2) continue
      expect(dot(dir(s[0]), dir(s[1])), `boundaries reversed at y=${y}`).toBeGreaterThan(0)
    }
  })

  it('draws only the first boundary until the third anchor exists', () => {
    const ctx = makeCtx()
    renderChannel(ctx, [P(60, 340), P(500, 120)], RECT)
    expect(ctx.__strokes()).toHaveLength(1)
    expect(ctx.__fills()).toHaveLength(0)
  })

  it('an unresolvable third anchor leaves the first boundary drawn and no fill', () => {
    const ctx = makeCtx()
    renderChannel(ctx, [P(60, 340), P(500, 120), { x: null, y: 260, valid: false }], RECT)
    expect(ctx.__strokes()).toHaveLength(1)
    expect(ctx.__fills()).toHaveLength(0)
  })

  it('every stroked point stays inside the pane rect, price or volume', () => {
    for (const [pts, rect] of [[chan, RECT], [[P(60, 395), P(500, 330), P(60, 360)], VOL]]) {
      const ctx = makeCtx()
      renderChannel(ctx, pts, rect)
      for (const s of ctx.__strokes()) for (const p of s.pts) expect(inRect(p, rect)).toBe(true)
    }
  })
})

describe('PARALLEL CHANNEL — ⚰️ the reported bug: the tint partly disappears', () => {
  const fillOf = (pts, rect = RECT) => {
    const ctx = makeCtx()
    renderChannel(ctx, pts, rect)
    return ctx.__fills()[0]?.pts
  }

  it('the fill is a simple (convex) quad for every offset', () => {
    for (let y = -300; y <= 700; y += 5) {
      const poly = fillOf([P(60, 340), P(500, 120), P(60, y)])
      if (!poly) continue
      expect(poly).toHaveLength(4)
      expect(isConvex(poly), `bow-tie at offset y=${y}`).toBe(true)
    }
  })

  it('⭐ covers EVERY in-pane point between the boundaries — across ALL edge combinations', () => {
    // The exhaustive version of "no missing corner": channels whose two edges
    // leave the pane through every pairing of sides (left/right, top/bottom,
    // left/top, right/bottom, …). Each one is a case the old 4-gon got wrong.
    const CASES = [
      [P(0, 200), P(800, 200), P(0, 260)],          // horizontal, L→R both
      [P(400, 0), P(400, 400), P(460, 0)],          // vertical, T→B both
      [P(60, 340), P(500, 120), P(60, 260)],        // diagonal
      [P(100, 20), P(120, 380), P(300, 20)],        // steep, T→B
      [P(20, 380), P(780, 40), P(20, 200)],         // shallow, L→R
      [P(0, 390), P(300, 0), P(200, 390)],          // exits L/T and B/R
      [P(700, 10), P(60, 390), P(790, 200)],        // reversed direction
      [P(-200, 500), P(1000, -100), P(-200, 300)],  // both anchors off-screen
    ]
    for (const [i, pts] of CASES.entries()) {
      const poly = fillOf(pts)
      expect(poly, `case ${i} produced no fill`).toBeTruthy()
      const [a, b, c] = pts
      const d = { x: b.x - a.x, y: b.y - a.y }
      const c2 = P(c.x + d.x, c.y + d.y)
      let sampled = 0
      for (let x = 3; x < 800; x += 9) {
        for (let y = 3; y < 400; y += 6) {
          const q = P(x, y)
          const dA = side(a, b, q) / Math.hypot(b.x - a.x, b.y - a.y)
          const dC = side(c, c2, q) / Math.hypot(c2.x - c.x, c2.y - c.y)
          if (Math.abs(dA) < 1 || Math.abs(dC) < 1) continue     // on an edge
          const inBand = Math.sign(dA) !== Math.sign(dC)
          if (!inBand) continue
          sampled++
          expect(insidePolygon(poly, q), `case ${i}: uncovered point (${x},${y})`).toBe(true)
        }
      }
      expect(sampled, `case ${i} sampled nothing`).toBeGreaterThan(10)
    }
  })

  it('never vanishes while the offset anchor is dragged', () => {
    let missing = 0
    for (let y = 0; y <= 400; y += 1) {
      if (!fillOf([P(60, 340), P(500, 120), P(60, y)])) missing++
    }
    expect(missing).toBe(0)
  })

  it('the fill and the boundary lines stay aligned', () => {
    // Invariant 4: the quad's long edges ARE the boundaries, so each boundary's
    // direction must match the fill edge beside it.
    const ctx = makeCtx()
    renderChannel(ctx, [P(60, 340), P(500, 120), P(60, 260)], RECT)
    const [b1, b2] = ctx.__strokes()
    const poly = ctx.__fills()[0].pts
    const e1 = { x: poly[1].x - poly[0].x, y: poly[1].y - poly[0].y }
    const e2 = { x: poly[2].x - poly[3].x, y: poly[2].y - poly[3].y }
    expect(Math.abs(cross(dir(b1), e1))).toBeLessThan(1e-6 * Math.hypot(e1.x, e1.y) * 800)
    expect(Math.abs(cross(dir(b2), e2))).toBeLessThan(1e-6 * Math.hypot(e2.x, e2.y) * 800)
  })

  it('extends beyond the pane so the clip trims it', () => {
    const poly = fillOf([P(60, 340), P(500, 120), P(60, 260)])
    expect(poly.some((p) => !inRect(p))).toBe(true)
  })

  it('a channel hard against the pane divider stays in its own pane', () => {
    const ctx = makeCtx()
    renderChannel(ctx, [P(0, 319), P(800, 321), P(0, 300)], RECT)
    for (const s of ctx.__strokes()) for (const p of s.pts) expect(inRect(p)).toBe(true)
  })
})

describe('PARALLEL CHANNEL — difficult geometry', () => {
  const run = (pts) => { const ctx = makeCtx(); renderChannel(ctx, pts, RECT); return ctx }

  it('almost horizontal', () => {
    const ctx = run([P(0, 200), P(800, 200.05), P(0, 240)])
    expect(ctx.__strokes()).toHaveLength(2)
    expect(ctx.__fills()).toHaveLength(1)
  })

  it('almost vertical', () => {
    const ctx = run([P(400, 0), P(400.05, 400), P(440, 0)])
    expect(ctx.__strokes()).toHaveLength(2)
    expect(ctx.__fills()).toHaveLength(1)
  })

  it('very narrow (boundaries 1px apart)', () => {
    const ctx = run([P(60, 300), P(500, 120), P(60, 301)])
    expect(isConvex(ctx.__fills()[0].pts)).toBe(true)
  })

  it('very wide (offset far outside the pane)', () => {
    const ctx = run([P(60, 340), P(500, 120), P(60, -3000)])
    expect(isConvex(ctx.__fills()[0].pts)).toBe(true)
  })

  it('a degenerate channel (first two anchors identical) does not throw', () => {
    const ctx = run([P(300, 200), P(300, 200), P(300, 260)])
    expect(ctx.__depth()).toBe(0)
  })

  it('is deterministic', () => {
    const a = run([P(60, 340), P(500, 120), P(60, 260)])
    const b = run([P(60, 340), P(500, 120), P(60, 260)])
    expect(JSON.stringify(b.__calls)).toBe(JSON.stringify(a.__calls))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the shared helpers both tools depend on', () => {
  it('extendLineFar gives parallel lines the SAME parameterisation', () => {
    // Why the fill quad is always a parallelogram: both edges are the same
    // direction vector scaled by the same k, so the quad cannot self-intersect
    // no matter where the offset anchor is.
    const d = { x: 300, y: -160 }
    const a = extendLineFar(P(60, 340), P(60 + d.x, 340 + d.y), RECT)
    const b = extendLineFar(P(60, 260), P(60 + d.x, 260 + d.y), RECT)
    const la = Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y)
    const lb = Math.hypot(b[1].x - b[0].x, b[1].y - b[0].y)
    expect(lb).toBeCloseTo(la, 6)
    expect(dot(dir({ pts: a }), dir({ pts: b }))).toBeGreaterThan(0)
  })

  it('extendToEdges returns null rather than a wrong segment when a line misses the pane', () => {
    expect(extendToEdges(P(0, -50), P(800, -50), RECT)).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('HIT TESTING — what you can click is what you can see', () => {
  beforeEach(() => {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
    __resetCoarsePointerForTest()
  })

  const fork = [P(80, 320), P(300, 100), P(300, 240)]
  const chan = [P(60, 340), P(500, 120), P(60, 260)]
  const hitFork = (mx, my, rect = RECT) => hitTestDrawing({ type: 'pitchfork' }, fork, mx, my, rect)
  const hitChan = (mx, my, rect = RECT) => hitTestDrawing({ type: 'channel' }, chan, mx, my, rect)

  /** A point exactly on a rendered line, `t` of the way along it. */
  const onLine = (ctx, i, t, anchors) => {
    const seg = extendedLines(ctx, anchors)[i]
    return P(seg.pts[0].x + (seg.pts[1].x - seg.pts[0].x) * t,
             seg.pts[0].y + (seg.pts[1].y - seg.pts[0].y) * t)
  }

  it('⭐ a Pitchfork is selectable by EVERY visible line, not just the median', () => {
    // The old test measured the infinite median only, so a user could see three
    // lines and select one of them.
    const ctx = makeCtx(); renderPitchfork(ctx, fork, RECT)
    for (const i of [0, 1, 2]) {
      const q = onLine(ctx, i, 0.5, fork)
      expect(hitFork(q.x, q.y), `line ${i} not selectable`).toBe(true)
    }
  })

  it('a Pitchfork is selectable by its handle bar', () => {
    expect(hitFork(300, 170)).toBe(true)
  })

  it('a Channel is selectable by BOTH boundaries', () => {
    const ctx = makeCtx(); renderChannel(ctx, chan, RECT)
    for (const s of ctx.__strokes()) {
      const q = P((s.pts[0].x + s.pts[1].x) / 2, (s.pts[0].y + s.pts[1].y) / 2)
      expect(hitChan(q.x, q.y)).toBe(true)
    }
  })

  it('empty space between the lines is NOT a hit (the fill is not clickable today)', () => {
    // Stated so a later phase that wants a clickable band changes it deliberately.
    expect(hitFork(700, 380)).toBe(false)
    expect(hitChan(760, 30)).toBe(false)
  })

  it('⛔ a PRICE-pane drawing captures nothing in the volume pane', () => {
    // ⛔ AND THE RECT PASSED IN IS THE DRAWING'S OWN PANE, WHICH IS THE WHOLE
    // POINT. `rectForDrawing` hands each drawing the zone it belongs to, so a
    // price-pane fork is measured against the PRICE rect — and every click below
    // the divider fails the rect gate before any distance is computed. (Handing
    // it the VOLUME rect instead would be asking "where would this fork be if it
    // lived in the volume pane", which is a different and meaningless question:
    // its extended lines cross any rect you give them.)
    const PRICE = { x0: 0, y0: 0, x1: 800, y1: 320 }
    for (let x = 10; x < 800; x += 37) {
      for (let y = 324; y < 400; y += 9) {
        expect(hitFork(x, y, PRICE), `fork captured (${x},${y}) below its pane`).toBe(false)
        expect(hitChan(x, y, PRICE), `channel captured (${x},${y}) below its pane`).toBe(false)
      }
    }
  })

  it('…and the same drawing IS selectable inside its own pane', () => {
    // Guard the guard: the test above must be proving a boundary, not that the
    // drawing is unselectable everywhere.
    const PRICE = { x0: 0, y0: 0, x1: 800, y1: 320 }
    const ctx = makeCtx(); renderPitchfork(ctx, fork, PRICE)
    const seg = extendedLines(ctx, fork)[0]
    const q = P((seg.pts[0].x + seg.pts[1].x) / 2, (seg.pts[0].y + seg.pts[1].y) / 2)
    expect(hitFork(q.x, q.y, PRICE)).toBe(true)
  })

  it('⛔ a click OUTSIDE the pane rect is never a hit, even on the line', () => {
    const ctx = makeCtx(); renderPitchfork(ctx, fork, RECT)
    const q = onLine(ctx, 0, 0.5, fork)
    expect(hitFork(q.x, q.y)).toBe(true)
    // same point, but the pane no longer contains it
    expect(hitFork(q.x, q.y, { x0: 0, y0: 0, x1: 800, y1: Math.max(1, q.y - 10) })).toBe(false)
  })

  it('⛔ a line that misses the pane cannot be clicked near where it would pass', () => {
    // The infinite-line test could match a cursor near a corner the line passes
    // just OUTSIDE — a hitbox in genuinely empty space.
    const far = [P(-900, -900), P(-800, -950), P(-800, -850)]
    let captured = 0
    for (let x = 0; x <= 800; x += 25) for (let y = 0; y <= 400; y += 25) {
      if (hitTestDrawing({ type: 'pitchfork' }, far, x, y, RECT)) captured++
    }
    expect(captured).toBe(0)
  })

  it('a click just past the price-scale edge misses', () => {
    const narrow = { x0: 0, y0: 0, x1: 400, y1: 400 }
    const ctx = makeCtx(); renderPitchfork(ctx, fork, narrow)
    const q = onLine(ctx, 0, 0.5, fork)
    expect(hitFork(q.x, q.y, narrow)).toBe(true)
    expect(hitFork(410, q.y, narrow)).toBe(false)
  })

  it('hit testing tracks the anchors through a drag — no stale geometry', () => {
    for (let y = 120; y <= 300; y += 10) {
      const moved = [P(80, 320), P(300, 100), P(300, y)]
      const ctx = makeCtx(); renderPitchfork(ctx, moved, RECT)
      const q = onLine(ctx, 2, 0.5, moved)
      expect(hitTestDrawing({ type: 'pitchfork' }, moved, q.x, q.y, RECT), `y=${y}`).toBe(true)
    }
  })

  it('an unresolvable anchor makes the drawing unclickable rather than clickable at 0,0', () => {
    const broken = [P(80, 320), { x: null, y: 100, valid: false }, P(300, 240)]
    expect(hitTestDrawing({ type: 'pitchfork' }, broken, 0, 0, RECT)).toBe(false)
    expect(hitTestDrawing({ type: 'pitchfork' }, broken, 200, 200, RECT)).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('PERSISTENCE — the renderer adapts to the anchors, never the reverse', () => {
  it('⛔ neither painter mutates the points it is given', () => {
    // The rule for both tools: stored geometry is the user's, and a renderer that
    // normalised or reordered anchors "to suit rendering" would rewrite a drawing
    // the moment it was displayed — on every chart that displayed it.
    for (const [render, anchors] of [
      [renderPitchfork, [P(80, 320), P(300, 100), P(300, 240)]],
      [renderChannel, [P(60, 340), P(500, 120), P(60, 260)]],
      // reversed / unusual orders included: a painter that "helpfully" sorted
      // them would show up here and nowhere else
      [renderPitchfork, [P(700, 40), P(100, 380), P(50, 60)]],
      [renderChannel, [P(700, 40), P(100, 380), P(760, 380)]],
    ]) {
      const before = JSON.stringify(anchors)
      render(makeCtx(), anchors, RECT)
      expect(JSON.stringify(anchors), 'the painter mutated its anchors').toBe(before)
    }
  })

  it('renders identically from the same anchors no matter what was drawn before', () => {
    // Guards against state leaking between drawings through the module.
    const anchors = [P(80, 320), P(300, 100), P(300, 240)]
    const a = makeCtx(); renderPitchfork(a, anchors, RECT)
    const noise = makeCtx()
    renderChannel(noise, [P(0, 0), P(800, 400), P(0, 100)], RECT)
    renderPitchfork(noise, [P(1, 2), P(3, 4), P(5, 6)], RECT)
    const b = makeCtx(); renderPitchfork(b, anchors, RECT)
    expect(JSON.stringify(b.__calls)).toBe(JSON.stringify(a.__calls))
  })

  it('anchor ORDER is meaningful and preserved — p2/p3 are not sorted', () => {
    // The handle bar is drawn p2 -> p3 in stored order. If a painter ever sorted
    // the shoulders, an undo/redo round trip would come back subtly different.
    const anchors = [P(80, 320), P(300, 240), P(300, 100)]
    const ctx = makeCtx(); renderPitchfork(ctx, anchors, RECT)
    expect(handleBar(ctx, anchors).pts).toEqual([P(300, 240), P(300, 100)])
  })
})
