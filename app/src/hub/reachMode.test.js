// Reach mode — the F-2 ruling, railed.
//
// ⛔ WHY THIS FILE EXISTS. Phase 2 device run 1, Pixel 8, measured: dragging to the
// Journal bubble fired Screener. The ring was read off knob travel alone
// (24 x 0.8 = 19.2px) while the bubbles are DRAWN at 96px and 150px, so an inner-ring
// action could only be selected inside a 9.2px annulus five times closer than the thing
// the user was aiming at. Journal, Notebook and Calendar were unreachable and silently
// fired a neighbour.
//
// ⭐ NOTE WHAT THE OLD UNIT TESTS COULD NOT SEE. `fanGeometry.test.js` passed throughout,
// because it feeds `resolveTarget` synthetic distances (INNER_DIST/OUTER_DIST) chosen to
// match the model under test. It never asked whether those distances are where the UI
// actually paints the bubbles. A geometry suite that picks its own coordinates cannot
// discover that the coordinates are wrong — only a device, or this file, can.

import { describe, it, expect } from 'vitest'
import { ringForPointer, resolveTarget } from './fanGeometry.js'
import {
  TRAVEL_PX,
  RING_SPLIT,
  RING_SPLIT_DROP,
  REACH_PX,
  reachMidpointPx,
  FAN_RADIUS_INNER,
  FAN_RADIUS_OUTER,
} from './constants.js'

const OUTER = 0
const INNER = 1

describe('reach mode — past REACH_PX the ring follows the POINTER, not the knob', () => {
  it('picks whichever DRAWN radius the pointer is nearer to', () => {
    expect(ringForPointer(FAN_RADIUS_INNER)).toBe(INNER)   // 96  -> inner
    expect(ringForPointer(100)).toBe(INNER)
    expect(ringForPointer(FAN_RADIUS_OUTER)).toBe(OUTER)   // 150 -> outer
    expect(ringForPointer(200)).toBe(OUTER)                // beyond the fan is still outer
  })

  it('splits at the midpoint of the two drawn radii, with the boundary itself OUTER', () => {
    const mid = reachMidpointPx()
    expect(mid).toBe(123)
    expect(ringForPointer(mid)).toBe(OUTER)        // >= is outer, per the ruling
    expect(ringForPointer(mid - 0.01)).toBe(INNER)
  })

  it('THE REGRESSION ITSELF: a pointer on the inner bubble selects the INNER ring', () => {
    // This is the exact assertion that would have failed before the fix, and the exact
    // behaviour the device measured as broken.
    expect(ringForPointer(FAN_RADIUS_INNER)).toBe(INNER)
  })

  it('resolves a ring-1 action when aimed at where a ring-1 bubble is drawn', () => {
    const actions = [
      { id: 'outer.a', ring: 0 }, { id: 'outer.b', ring: 0 },
      { id: 'inner.a', ring: 1 }, { id: 'inner.b', ring: 1 },
    ]
    // Straight up-left, at the inner ring's drawn radius.
    const rad = (135 * Math.PI) / 180
    const hit = resolveTarget({
      dx: Math.cos(rad) * FAN_RADIUS_INNER,
      dy: -Math.sin(rad) * FAN_RADIUS_INNER,
      actions,
    })
    expect(hit).not.toBeNull()
    expect(hit.ring).toBe(INNER)
    expect(hit.action.ring).toBe(1)
  })
})

describe('legacy short push — under REACH_PX the knob-travel model still applies', () => {
  it('uses ring-by-travel below the reach threshold', () => {
    // r = 40 is a short push: under REACH_PX (56), so travel decides.
    // 40 >= TRAVEL_PX * 0.5 (12) => outer.
    expect(ringForPointer(40, { travelPx: TRAVEL_PX })).toBe(OUTER)
    expect(ringForPointer(TRAVEL_PX * RING_SPLIT)).toBe(OUTER)
    expect(ringForPointer(TRAVEL_PX * RING_SPLIT - 0.01)).toBe(INNER)
    expect(ringForPointer(0)).toBe(INNER)
  })

  it('REACH_PX is the boundary between the two models', () => {
    expect(REACH_PX).toBe(56)
    // Just under: travel model. Just over: proximity model, and 56 < 123 => inner.
    expect(ringForPointer(REACH_PX - 0.01, { travelPx: TRAVEL_PX })).toBe(OUTER)
    expect(ringForPointer(REACH_PX)).toBe(INNER)
  })
})

describe('hysteresis — a tremor across the threshold must not flip the ring', () => {
  const t = TRAVEL_PX
  const enter = t * RING_SPLIT       // 12
  const drop = t * RING_SPLIT_DROP   // 8.4

  it('enters the outer ring at RING_SPLIT when coming from inner', () => {
    expect(ringForPointer(enter, { travelPx: t, prevRing: INNER })).toBe(OUTER)
    expect(ringForPointer(enter - 0.01, { travelPx: t, prevRing: INNER })).toBe(INNER)
  })

  it('HOLDS the outer ring between the drop and entry thresholds', () => {
    // Without hysteresis every one of these would read INNER, and the selection would
    // change under a thumb the user never meant to move.
    expect(ringForPointer(enter - 0.01, { travelPx: t, prevRing: OUTER })).toBe(OUTER)
    expect(ringForPointer(drop, { travelPx: t, prevRing: OUTER })).toBe(OUTER)
    expect(ringForPointer(drop + 0.01, { travelPx: t, prevRing: OUTER })).toBe(OUTER)
  })

  it('falls back to inner only BELOW the drop threshold', () => {
    expect(ringForPointer(drop - 0.01, { travelPx: t, prevRing: OUTER })).toBe(INNER)
  })

  it('the two thresholds are genuinely different — otherwise there is no hysteresis', () => {
    // A control: if someone "simplifies" RING_SPLIT_DROP to equal RING_SPLIT, the band
    // above collapses and this fails, naming the reason.
    expect(RING_SPLIT_DROP).toBeLessThan(RING_SPLIT)
    expect(drop).toBeLessThan(enter)
  })

  it('reach mode ignores hysteresis entirely — proximity is unambiguous there', () => {
    expect(ringForPointer(FAN_RADIUS_INNER, { prevRing: OUTER })).toBe(INNER)
    expect(ringForPointer(FAN_RADIUS_OUTER, { prevRing: INNER })).toBe(OUTER)
  })
})

describe('tremor settings do not reopen F-2', () => {
  it('a lowered travel does not shrink the reachable band, because reach mode owns it', () => {
    // At travelPx 16 the legacy band is 8 -> 5.6px, which is alarming in isolation and
    // IRRELEVANT: both drawn radii are past REACH_PX, so both rings stay reachable.
    expect(ringForPointer(FAN_RADIUS_INNER, { travelPx: 16 })).toBe(INNER)
    expect(ringForPointer(FAN_RADIUS_OUTER, { travelPx: 16 })).toBe(OUTER)
    expect(ringForPointer(FAN_RADIUS_INNER, { travelPx: 48 })).toBe(INNER)
    expect(ringForPointer(FAN_RADIUS_OUTER, { travelPx: 48 })).toBe(OUTER)
  })
})

describe('resolveTarget honours an explicitly passed ring', () => {
  it('does not recompute the ring when the caller already decided it', () => {
    // useJoystick computes the ring once (with hysteresis) and passes it in. If
    // resolveTarget recomputed, the two would disagree the moment hysteresis mattered.
    const actions = [{ id: 'o', ring: 0 }, { id: 'i', ring: 1 }]
    const rad = (135 * Math.PI) / 180
    const at = (r) => ({ dx: Math.cos(rad) * r, dy: -Math.sin(rad) * r })

    // At 150px proximity says OUTER, but the caller says INNER and the caller wins.
    const forced = resolveTarget({ ...at(FAN_RADIUS_OUTER), actions, ring: 1 })
    expect(forced.action.id).toBe('i')
    const natural = resolveTarget({ ...at(FAN_RADIUS_OUTER), actions })
    expect(natural.action.id).toBe('o')
  })
})
