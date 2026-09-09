// Joystick hub — fan geometry rail: angles → the right action, for EVERY ring/count in the registry.
// See docs/plans/joystick/00-master-spec-v1.4.md §5 and 30-phase2-plan.md §3.4 (acceptance).
//
// ⭐ This is the file where "the fan feels wrong" becomes a number. jsdom lays nothing out, so a
// rendered bubble's position is untestable here — but the geometry that DECIDES which action a
// thumb angle selects is pure maths, and that is exactly the part a user experiences as a misfire.

import { describe, it, expect } from 'vitest'
import {
  wedgeAngles,
  resolveTarget,
  ringForDistance,
  pointerAngle,
  mirrorDeg,
  angleDistance,
  fanLayout,
  bubbleOffset,
  selectWindowFor,
} from './fanGeometry.js'
import { TRAVEL_PX, RING_SPLIT, SELECT_WINDOW_DEG, FAN_RADIUS_OUTER, FAN_RADIUS_INNER } from './constants.js'
import { modes } from './registry.js'

let executed = 0
const ran = () => { executed += 1 }

/** A pointer at `deg` and `dist` from centre, in screen coords (y down). */
const at = (deg, dist) => ({
  dx: Math.cos((deg * Math.PI) / 180) * dist,
  dy: -Math.sin((deg * Math.PI) / 180) * dist,
})

// ⛔ THE PROBE DISTANCES ARE THE DRAWN RADII, NOT KNOB TRAVEL — AND THAT IS THE FIX.
//
// These were `TRAVEL_PX` and `TRAVEL_PX * 0.5`: distances chosen to satisfy the model
// under test. That is exactly how F-2 shipped green. This suite asked "does a pointer at
// 12px select the inner ring?" and never "is 12px where the inner ring is DRAWN?" — it
// is not; the inner bubbles are painted at 96px. A geometry suite that picks its own
// coordinates cannot discover that the coordinates are wrong.
//
// Probing at FAN_RADIUS_INNER / FAN_RADIUS_OUTER makes every assertion below a statement
// about the fan the user actually sees and aims at.
const OUTER_DIST = FAN_RADIUS_OUTER   // where ring-0 bubbles are drawn
const INNER_DIST = FAN_RADIUS_INNER   // where ring-1 bubbles are drawn

describe('wedgeAngles', () => {
  it('puts a lone action at the arc midpoint, not hanging off an end', () => {
    ran()
    expect(wedgeAngles(1)).toEqual([135])
  })

  it('spreads two actions end to end', () => {
    ran()
    expect(wedgeAngles(2)).toEqual([90, 180])
  })

  it('spreads five evenly across the quadrant', () => {
    ran()
    expect(wedgeAngles(5)).toEqual([90, 112.5, 135, 157.5, 180])
  })

  it('is empty for zero or nonsense', () => {
    ran()
    expect(wedgeAngles(0)).toEqual([])
    expect(wedgeAngles(-3)).toEqual([])
    expect(wedgeAngles(NaN)).toEqual([])
  })

  it('never places two actions closer than twice the selection window would allow to be ambiguous', () => {
    ran()
    // 5 actions across 90° = 22.5° apart. With a ±30° window the bands OVERLAP — which is fine and
    // intended: nearest-wins resolves it, and overlap is what keeps the whole quadrant live. What
    // must hold is that each action is still strictly nearest at its OWN angle.
    for (let n = 1; n <= 5; n += 1) {
      const angles = wedgeAngles(n)
      angles.forEach((a, i) => {
        const distances = angles.map((b) => angleDistance(a, b))
        const min = Math.min(...distances)
        expect(distances.indexOf(min), `n=${n} action ${i} is not nearest to its own angle`).toBe(i)
      })
    }
  })
})

describe('ringForDistance — soft push vs hard push', () => {
  it('selects the inner ring below the split and the outer ring at or above it', () => {
    ran()
    expect(ringForDistance(0)).toBe(1)
    expect(ringForDistance(TRAVEL_PX * RING_SPLIT - 0.01)).toBe(1)
    expect(ringForDistance(TRAVEL_PX * RING_SPLIT)).toBe(0)
    expect(ringForDistance(TRAVEL_PX)).toBe(0)
  })

  it('scales with a user-lowered travel — the split is a RATIO, not a fixed pixel count', () => {
    ran()
    // A tremor user on travelPx=16: 10px is a hard push (10 >= 8), and at the default
    // travel=24 the same 10px is still soft (10 < 12).
    // ⚰️ The probe distances moved from 13 to 10 when RING_SPLIT went 0.8 -> 0.5 (F-2).
    // The PROPERTY under test is unchanged — one distance, two travels, two rings — and
    // it is the property, not the pixel count, that this rail exists to hold.
    expect(ringForDistance(10, 16)).toBe(0)
    expect(ringForDistance(10, 24)).toBe(1)
  })
})

describe('pointerAngle — screen coords have y DOWN', () => {
  it('reads straight up as 90°, not 270°', () => {
    ran()
    expect(pointerAngle(0, -10)).toBeCloseTo(90)
  })

  it('reads left as 180° and up-left as 135°', () => {
    ran()
    expect(pointerAngle(-10, 0)).toBeCloseTo(180)
    expect(pointerAngle(-10, -10)).toBeCloseTo(135)
  })
})

describe('resolveTarget', () => {
  const outer = (n) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, ring: 0 }))
  const inner = (n) => Array.from({ length: n }, (_, i) => ({ id: `i${i}`, ring: 1 }))

  it('selects the action whose wedge the pointer is in, on the outer ring', () => {
    ran()
    const actions = [...outer(5), ...inner(4)]
    const angles = wedgeAngles(5)
    angles.forEach((deg, i) => {
      const hit = resolveTarget({ ...at(deg, OUTER_DIST), actions })
      expect(hit?.action.id, `outer ${i} at ${deg}°`).toBe(`o${i}`)
      expect(hit?.ring).toBe(0)
    })
  })

  it('selects from the INNER ring on a soft push, at the same angles', () => {
    ran()
    const actions = [...outer(5), ...inner(4)]
    const angles = wedgeAngles(4)
    angles.forEach((deg, i) => {
      const hit = resolveTarget({ ...at(deg, INNER_DIST), actions })
      expect(hit?.action.id, `inner ${i} at ${deg}°`).toBe(`i${i}`)
      expect(hit?.ring).toBe(1)
    })
  })

  it('returns null outside the acceptance band — cancelling must remain possible', () => {
    ran()
    const actions = [...outer(3), ...inner(2)]
    // Down-right: the natural "I did not mean this" direction.
    expect(resolveTarget({ ...at(315, OUTER_DIST), actions })).toBeNull()
    expect(resolveTarget({ ...at(0, OUTER_DIST), actions })).toBeNull()
    expect(resolveTarget({ ...at(270, OUTER_DIST), actions })).toBeNull()
  })

  it('returns null when a ring is empty rather than falling through to the other ring', () => {
    ran()
    // Flow's fan is inner-only. A hard push must select NOTHING, not silently fire an inner action.
    const flowLike = [{ id: 'voice', ring: 1 }, { id: 'home', ring: 1 }]
    expect(resolveTarget({ ...at(135, OUTER_DIST), actions: flowLike })).toBeNull()
    expect(resolveTarget({ ...at(135, INNER_DIST), actions: flowLike })).not.toBeNull()
  })

  it('keeps the middle of a 2-action fan LIVE — the dead-zone this rail caught', () => {
    ran()
    // 2 actions sit at 90° and 180°. Under a fixed ±30° window a thumb at 135° — the middle of
    // the fan — was 45° from both and selected nothing. Every 2-action ring in the registry had
    // this hole, Flow's entire fan included.
    const two = [{ id: 'a', ring: 0 }, { id: 'b', ring: 0 }]
    expect(resolveTarget({ ...at(135, OUTER_DIST), actions: two })).not.toBeNull()
    // Nearest still wins on either side of the midpoint.
    expect(resolveTarget({ ...at(120, OUTER_DIST), actions: two })?.action.id).toBe('a')
    expect(resolveTarget({ ...at(150, OUTER_DIST), actions: two })?.action.id).toBe('b')
  })

  it('a DENSE fan keeps the ±30° floor rather than shrinking below it', () => {
    ran()
    // 5 actions are 22.5° apart, so half-spacing is 11.25° — below the floor. The window stays 30°
    // and the bands overlap; nearest-wins is what resolves them.
    expect(selectWindowFor(5)).toBe(SELECT_WINDOW_DEG)
    expect(selectWindowFor(2)).toBe(45)
  })

  it('still refuses a pointer well outside any wedge, even with the widened window', () => {
    ran()
    const actions = [{ id: 'only', ring: 0 }]  // 135°, window = 45°
    expect(resolveTarget({ ...at(135 + 44, OUTER_DIST), actions })?.action.id).toBe('only')
    // 135+46 = 181° is past the acceptance band's own edge behaviour; use the band directly.
    expect(resolveTarget({ ...at(300, OUTER_DIST), actions })).toBeNull()
  })

  it('mirrors to the upper-RIGHT quadrant for a left-handed user, same wedge order', () => {
    ran()
    const actions = outer(3)
    const angles = wedgeAngles(3)
    angles.forEach((deg, i) => {
      const hit = resolveTarget({ ...at(mirrorDeg(deg), OUTER_DIST), actions, mirrored: true })
      expect(hit?.action.id, `mirrored ${i}`).toBe(`o${i}`)
    })
    // The un-mirrored upper-LEFT angle now selects nothing for a left-handed user — that is the
    // point of mirroring, and the assertion that would fail if `mirrored` were ignored.
    expect(resolveTarget({ ...at(135, OUTER_DIST), actions, mirrored: true })).toBeNull()
    expect(resolveTarget({ ...at(45, OUTER_DIST), actions, mirrored: false })).toBeNull()
  })
})

describe('EVERY ring/count combination in the shipped registry resolves uniquely', () => {
  it('each action is selectable at its own wedge angle, in both rings, in both handednesses', () => {
    ran()
    for (const mode of modes) {
      for (const mirrored of [false, true]) {
        for (const ring of [0, 1]) {
          const inRing = mode.fan.filter((a) => a.ring === ring)
          if (inRing.length === 0) continue
          const dist = ring === 0 ? OUTER_DIST : INNER_DIST
          const angles = wedgeAngles(inRing.length)
          angles.forEach((deg, i) => {
            const probe = mirrored ? mirrorDeg(deg) : deg
            const hit = resolveTarget({ ...at(probe, dist), actions: mode.fan, mirrored })
            expect(
              hit?.action.id,
              `${mode.id} ring ${ring} slot ${i} (${inRing.length} actions, mirrored=${mirrored})`,
            ).toBe(inRing[i].id)
          })
        }
      }
    }
  })

  it('covers every distinct fan shape the registry actually contains', () => {
    ran()
    const shapes = new Set(
      modes.map((m) => `${m.fan.filter((a) => a.ring === 0).length}x${m.fan.filter((a) => a.ring === 1).length}`),
    )
    // Non-vacuity: if the registry ever collapsed to one shape, the sweep above would prove little.
    expect(shapes.size).toBeGreaterThanOrEqual(4)
  })
})

describe('fanLayout / bubbleOffset', () => {
  it('places outer bubbles farther out than inner ones', () => {
    ran()
    const o = bubbleOffset(135, 0)
    const i = bubbleOffset(135, 1)
    expect(Math.hypot(o.x, o.y)).toBeCloseTo(FAN_RADIUS_OUTER)
    expect(Math.hypot(i.x, i.y)).toBeCloseTo(FAN_RADIUS_INNER)
  })

  it('places the upper-left fan up and to the LEFT (negative x, negative y in screen coords)', () => {
    ran()
    const { x, y } = bubbleOffset(135, 0)
    expect(x).toBeLessThan(0)
    expect(y).toBeLessThan(0)
  })

  it('mirrors to positive x for a left-handed fan', () => {
    ran()
    expect(bubbleOffset(135, 0, { mirrored: true }).x).toBeGreaterThan(0)
  })

  it('returns one entry per action, with a matching angle for every mode', () => {
    ran()
    for (const mode of modes) {
      const layout = fanLayout(mode.fan)
      expect(layout).toHaveLength(mode.fan.length)
      for (const entry of layout) {
        const hit = resolveTarget({
          ...at(entry.angle, entry.ring === 0 ? OUTER_DIST : INNER_DIST),
          actions: mode.fan,
        })
        expect(hit?.action.id, `${mode.id}/${entry.action.id} layout angle disagrees with selection`)
          .toBe(entry.action.id)
      }
    }
  })
})

describe('rail integrity', () => {
  it('actually executed its cases — a vitest -t regex matching nothing exits 0 and reads as a PASS', () => {
    expect(executed).toBeGreaterThanOrEqual(18)
  })
})
