/**
 * D-39 — the clearance decision, railed as a pure function.
 *
 * ⭐ The DOM half is deliberately thin so that THIS is where the thinking is tested. jsdom performs
 * no layout, so a test that rendered the component and asked "is the chip clear?" would be asking a
 * question the engine cannot answer — every rect is zero and `elementFromPoint` does not exist.
 * `HubChip.clearance.test.jsx` covers the wiring with stubbed geometry; this covers the decision.
 */
import { describe, it, expect } from 'vitest'

import {
  PROBE_SAMPLES, clearedCeiling, floorWidth, geometryKey, isOccluder, probePoints,
} from './chipClearance'

const rect = (left, right, top = 700, bottom = 728) => ({
  left, right, top, bottom, width: right - left, height: bottom - top,
})

// The measured case from the sweep: journal @393, chip anchored right at 275, FAB at [16, 72].
const CHIP = rect(24, 275)
const MODE = rect(36, 100)
const HINT = rect(106, 263)
const FAB = rect(16, 72, 690, 746)

const el = (over = {}) => ({
  closest: () => null,
  getBoundingClientRect: () => FAB,
  ...over,
})

describe('⛔ isOccluder — agrees with tools/hub_chip_clearance.py, or the fix fails the sweep', () => {
  const chipEl = { contains: (x) => x === 'inside' }

  it('a foreign element IS a coverer', () => {
    expect(isOccluder(el(), chipEl)).toBe(true)
  })

  it('the chip itself is NOT', () => {
    expect(isOccluder(chipEl, chipEl)).toBe(false)
  })

  it('a DESCENDANT of the chip is NOT — the instrument uses chip.contains, so this must too', () => {
    expect(isOccluder('inside', chipEl)).toBe(false)
  })

  it('null is NOT — a point outside the document has nothing to clear', () => {
    expect(isOccluder(null, chipEl)).toBe(false)
  })

  it('⚰️ the INTRO ANIMATION is NOT — it cost this row a withdrawn defect once already', () => {
    // Its capability pills are anonymous spans; only the root's aria-label identifies it. A clamp
    // taken against it would be KEPT after it disappeared, because release is input-driven.
    const intro = el({ closest: (sel) => (sel === '[aria-label="Welcome"]' ? {} : null) })
    expect(isOccluder(intro, chipEl)).toBe(false)
  })
})

describe('⛔ clearedCeiling — the chip clears the furniture, and the mode name survives', () => {
  it('unmirrored: the chip is anchored RIGHT, so it shrinks to start where the coverer ends', () => {
    // chipRight 275 - coverRight 72 = 203, which is above the floor, so the floor does not bind.
    expect(clearedCeiling({ chipRect: CHIP, coverRect: FAB, mirrored: false, floorPx: 88 }))
      .toBe(203)
  })

  it('mirrored: anchored LEFT, so it shrinks to END where the coverer starts', () => {
    const chip = rect(118, 369)
    const cover = rect(340, 400)
    expect(clearedCeiling({ chipRect: chip, coverRect: cover, mirrored: true, floorPx: 88 }))
      .toBe(222)
  })

  it('⛔ THE FLOOR WINS over the coverer — the mode name must survive, the hint may yield', () => {
    // A coverer reaching to x=250 would demand 25px, which would erase the label entirely.
    const greedy = rect(0, 250)
    expect(clearedCeiling({ chipRect: CHIP, coverRect: greedy, mirrored: false, floorPx: 88 }))
      .toBe(88)
  })

  it('a coverer that does not actually constrain the chip returns null, not a no-op clamp', () => {
    // Its right edge is left of the chip, so `want` >= the chip's own width.
    expect(clearedCeiling({ chipRect: CHIP, coverRect: rect(0, 10), mirrored: false, floorPx: 88 }))
      .toBeNull()
  })

  it('missing geometry returns null rather than NaN', () => {
    expect(clearedCeiling({ chipRect: null, coverRect: FAB, mirrored: false, floorPx: 0 })).toBeNull()
    expect(clearedCeiling({ chipRect: CHIP, coverRect: null, mirrored: false, floorPx: 0 })).toBeNull()
  })
})

describe('⛔ floorWidth — MEASURED, never the stylesheet re-typed', () => {
  it('is left padding + the mode name + right padding', () => {
    // 12 + 64 + 12. Nothing here restates `padding: 0 12px` from hub.module.css.
    expect(floorWidth({ chipRect: CHIP, modeRect: MODE, hintRect: HINT })).toBe(88)
  })

  it('⭐ is STABLE while the chip is clamped — which is what stops the floor drifting', () => {
    // Clamped to 203 the whole chip shifts right: box [72, 275], and because `.chipMode` is
    // `flex: 0 0 auto` the label rides along at the same 12px inset and the same 64px wide. Only
    // `.chipHint` gives up room. The floor must therefore read IDENTICALLY, or a second measure
    // would compute a different minimum than the first and the clamp could creep.
    const clampedChip = rect(72, 275)
    const clampedMode = rect(84, 148)
    const clampedHint = rect(154, 263)
    expect(floorWidth({ chipRect: clampedChip, modeRect: clampedMode, hintRect: clampedHint }))
      .toBe(floorWidth({ chipRect: CHIP, modeRect: MODE, hintRect: HINT }))
  })

  it('falls back to a symmetric pad when there is no hint, rather than returning a short floor', () => {
    expect(floorWidth({ chipRect: CHIP, modeRect: MODE, hintRect: null })).toBe(88)
  })
})

describe('⛔ probePoints — the LEADING edge is sampled first', () => {
  it('unmirrored starts at the LEFT edge, which is the end that meets furniture', () => {
    const xs = probePoints({ chipRect: CHIP, mirrored: false })
    expect(xs).toHaveLength(PROBE_SAMPLES)
    expect(xs[0]).toBeCloseTo(25, 5)
    expect(xs[xs.length - 1]).toBeCloseTo(274, 5)
  })

  it('mirrored starts at the RIGHT edge', () => {
    const xs = probePoints({ chipRect: CHIP, mirrored: true })
    expect(xs[0]).toBeCloseTo(274, 5)
    expect(xs[xs.length - 1]).toBeCloseTo(25, 5)
  })

  it('a zero-width chip yields NO samples — an empty sweep must not read as "clear"', () => {
    // Non-vacuity: the caller treats no-occluder-found as clear, so a chip that was never
    // measurable must be distinguishable from one that was measured and found clean.
    expect(probePoints({ chipRect: rect(10, 10), mirrored: false })).toEqual([])
  })
})

describe('⛔ geometryKey — the identity that RELEASE depends on', () => {
  it('changes with the viewport, the inset and the handedness, and with nothing else', () => {
    const base = { viewportWidth: 393, inset: 118, mirrored: false }
    expect(geometryKey(base)).toBe(geometryKey({ ...base }))
    expect(geometryKey({ ...base, viewportWidth: 430 })).not.toBe(geometryKey(base))
    expect(geometryKey({ ...base, inset: 166 })).not.toBe(geometryKey(base))
    expect(geometryKey({ ...base, mirrored: true })).not.toBe(geometryKey(base))
  })
})
