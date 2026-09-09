// Joystick hub — pure fan geometry: where every bubble sits, and which one a pointer angle selects.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 (wedge selection) and §C1 (soft/hard push).
//
// ⭐ SELECTION IS BY WEDGE ANGLE, NEVER BY HIT-TESTING A BUBBLE. A 46px circle at a 150px radius
// subtends about 17°, so hit-testing leaves ~73° of the quadrant dead — the thumb is between
// bubbles and nothing is selected. Angle selection makes the whole quadrant live, which is what
// makes the gesture feel like a joystick rather than a menu.
//
// Everything here is pure: no React, no DOM, no time. That is deliberate — this is the file whose
// correctness a unit test can actually establish, and jsdom lays nothing out.

import {
  QUADRANT_DEG,
  FAN_RADIUS_OUTER,
  FAN_RADIUS_INNER,
  ringSplitPx,
  ringDropPx,
  REACH_PX,
  reachMidpointPx,
  TRAVEL_PX,
} from './constants.js'

import { SELECT_WINDOW_DEG } from './constants.js'

/** Standard math degrees: 0 = right, 90 = up. The fan's usable arc is 90°…180° (upper-left). */
const ARC_START = 90
const ARC_END = 180

/**
 * The acceptance half-width for a fan of `n` actions: half the spacing between neighbours, with
 * `SELECT_WINDOW_DEG` (±30°) as a FLOOR, not a cap.
 *
 * ⚠️ A FIXED ±30° LEAVES A DEAD ZONE, and this rail caught it: two actions sit at 90° and 180°,
 * so a thumb at 135° — the middle of the fan, the most natural place to point — is 45° from both
 * and selects nothing. Flow's `[Voice, Home]` is exactly that shape, as is every 2-action inner
 * ring in the registry. A dead patch in the middle of the fan contradicts the whole reason
 * selection is by angle rather than by hit-testing a bubble.
 *
 * Sparse fans therefore get wide wedges (n=2 → ±45°, whole arc live); dense fans keep the ±30°
 * floor and OVERLAP, which is fine — nearest-wins resolves it, and the overlap is what stops a
 * thumb ever falling between two bubbles.
 */
export function selectWindowFor(n) {
  if (!Number.isFinite(n) || n <= 1) return Math.max(SELECT_WINDOW_DEG, (ARC_END - ARC_START) / 2)
  const step = (ARC_END - ARC_START) / (n - 1)
  return Math.max(SELECT_WINDOW_DEG, step / 2)
}

/**
 * Angles for `n` actions spread across the upper-left quadrant, in visual order.
 *
 * One action sits at the arc's midpoint (135°) rather than at an end — a lone bubble hanging off
 * the edge of the quadrant reads as a rendering bug. Two or more spread evenly end to end.
 *
 * @param {number} n
 * @returns {number[]} degrees, ascending (90 = straight up-right end, 180 = straight left)
 */
export function wedgeAngles(n) {
  if (!Number.isFinite(n) || n <= 0) return []
  if (n === 1) return [(ARC_START + ARC_END) / 2]
  const step = (ARC_END - ARC_START) / (n - 1)
  return Array.from({ length: n }, (_, i) => ARC_START + i * step)
}

/**
 * Normalize any angle into [0, 360).
 * `Math.atan2` returns (-180, 180]; the fan's arc straddles neither wrap point, but a mirrored
 * (left-handed) fan does, so normalizing once here keeps every caller honest.
 */
export const normalizeDeg = (deg) => ((deg % 360) + 360) % 360

/** Smallest absolute distance between two angles, accounting for wrap. */
export function angleDistance(a, b) {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b))
  return d > 180 ? 360 - d : d
}

/**
 * The pointer's angle from the pad centre, in standard math degrees.
 * Screen Y grows downward, so dy is negated — miss this and the fan is mirrored vertically.
 */
export const pointerAngle = (dx, dy) => normalizeDeg((Math.atan2(-dy, dx) * 180) / Math.PI)

/**
 * Mirror an angle across the vertical axis, for left-handed mode.
 * The fan then occupies the upper-RIGHT quadrant (0°…90°) and the maths is otherwise identical —
 * one transform instead of a second set of angle tables that could drift from the first.
 */
export const mirrorDeg = (deg) => normalizeDeg(180 - deg)

/**
 * Which ring does this push distance select?
 * Soft push (short) = inner ring, hard push (long) = outer. Split at 80% of travel.
 *
 * @returns {0|1} 0 = outer, 1 = inner — matching `HubAction.ring`
 */
export const ringForDistance = (dist, travelPx = TRAVEL_PX) => (dist >= ringSplitPx(travelPx) ? 0 : 1)

/**
 * Which ring does this POINTER select? The one authority — `ringForDistance` above is
 * only the short-push half of it.
 *
 * ⛔ TWO MODES, AND THE BOUNDARY BETWEEN THEM IS THE WHOLE POINT (spec §C1, "reach mode").
 *
 *   r <  REACH_PX : legacy short push. Ring by KNOB TRAVEL, with hysteresis so a tremor
 *                   across the threshold cannot flip the selection: enter outer at
 *                   `RING_SPLIT`, fall back to inner only below `RING_SPLIT_DROP`.
 *   r >= REACH_PX : reach mode. Ring is whichever DRAWN radius the pointer is nearer to,
 *                   split at `reachMidpointPx()` (123px). `>=` puts the boundary itself
 *                   on the outer ring.
 *
 * Reach mode exists because the old model made the drawn bubbles lie: measured on a real
 * Pixel 8, dragging to the Journal bubble (ring 1, drawn at 96px) fired Screener, because
 * anything past 19.2px read as the outer ring. The affordance wins — see `REACH_PX`.
 *
 * @param {number}  dist                 pointer distance from the pad centre, px
 * @param {object} [opts]
 * @param {number} [opts.travelPx]       user-adjustable travel
 * @param {0|1|null} [opts.prevRing]     the ring selected on the previous move, for hysteresis
 * @returns {0|1} 0 = outer, 1 = inner — matching `HubAction.ring`
 */
export function ringForPointer(dist, { travelPx = TRAVEL_PX, prevRing = null } = {}) {
  if (dist >= REACH_PX) return dist >= reachMidpointPx() ? 0 : 1
  // Already on the outer ring: hold it until the thumb comes decisively back in.
  if (prevRing === 0) return dist < ringDropPx(travelPx) ? 1 : 0
  return dist >= ringSplitPx(travelPx) ? 0 : 1
}

/**
 * Resolve a pointer position to the action it selects, or null.
 *
 * @param {object}   args
 * @param {number}   args.dx           pointer x minus pad-centre x
 * @param {number}   args.dy           pointer y minus pad-centre y (screen coords, y down)
 * @param {Array}    args.actions      the mode's fan, each `{ring}` — order within a ring is visual order
 * @param {number}  [args.travelPx]    user-adjustable travel
 * @param {boolean} [args.mirrored]    left-handed
 * @param {0|1|null} [args.prevRing]   previous ring, for reach-mode hysteresis
 * @param {0|1}     [args.ring]        an already-decided ring. ⭐ Pass this when the caller
 *   has ALSO computed the ring for its own state (as `useJoystick` does): recomputing it
 *   here from the same inputs is a second authority over one value, and the two copies
 *   drift the moment one of them learns about hysteresis and the other does not.
 * @returns {{action: object, index: number, angle: number, ring: 0|1}|null}
 */
export function resolveTarget({
  dx, dy, actions, travelPx = TRAVEL_PX, mirrored = false, prevRing = null, ring: ringOverride,
}) {
  const dist = Math.hypot(dx, dy)
  const ring = ringOverride != null
    ? ringOverride
    : ringForPointer(dist, { travelPx, prevRing })
  const inRing = (actions || []).filter((a) => a.ring === ring)
  if (inRing.length === 0) return null

  // Fold a mirrored pointer back into the canonical upper-left frame, so one angle table serves
  // both handednesses. Mirroring the TABLE instead would be a second authority over wedge order.
  const raw = pointerAngle(dx, dy)
  const angle = mirrored ? mirrorDeg(raw) : raw

  // Outside the acceptance band the thumb is nowhere near the fan — e.g. dragging down and right,
  // which is how a user cancels. Selecting the nearest wedge anyway would make cancelling
  // impossible.
  const [lo, hi] = QUADRANT_DEG
  if (angle < lo || angle > hi) return null

  const angles = wedgeAngles(inRing.length)
  let best = null
  let bestDist = Infinity
  for (let i = 0; i < inRing.length; i += 1) {
    const d = angleDistance(angle, angles[i])
    if (d < bestDist) {
      bestDist = d
      best = { action: inRing[i], index: i, angle: angles[i], ring }
    }
  }
  return bestDist <= selectWindowFor(inRing.length) ? best : null
}

/**
 * Where a bubble is drawn, as an offset in px from the pad centre (screen coords, y down).
 * @returns {{x: number, y: number}}
 */
export function bubbleOffset(angleDeg, ring, { mirrored = false } = {}) {
  const radius = ring === 0 ? FAN_RADIUS_OUTER : FAN_RADIUS_INNER
  const deg = mirrored ? mirrorDeg(angleDeg) : angleDeg
  const rad = (deg * Math.PI) / 180
  return { x: Math.cos(rad) * radius, y: -Math.sin(rad) * radius }
}

/**
 * The full render model for a mode's fan: every action with its angle, ring, radius and offset.
 * The UI consumes this and does no trigonometry of its own — one owner for the geometry.
 */
export function fanLayout(actions, { mirrored = false } = {}) {
  const out = []
  for (const ring of [0, 1]) {
    const inRing = (actions || []).filter((a) => a.ring === ring)
    const angles = wedgeAngles(inRing.length)
    inRing.forEach((action, i) => {
      out.push({
        action,
        ring,
        index: i,
        angle: angles[i],
        radius: ring === 0 ? FAN_RADIUS_OUTER : FAN_RADIUS_INNER,
        offset: bubbleOffset(angles[i], ring, { mirrored }),
      })
    })
  }
  return out
}
