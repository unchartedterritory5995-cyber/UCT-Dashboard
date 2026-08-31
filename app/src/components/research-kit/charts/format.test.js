import { describe, it, expect } from 'vitest'
import { labelStep, MIN_LABEL_SLOT_PX } from './format'

// `formatSigned` and `toNum` are exercised through HeatGrid/MetricTrendChart's
// own suites (HeatGrid re-exports them). This file owns `labelStep`, which is
// new and has no component suite that can see it: jsdom computes no layout, so
// nothing else in the kit can tell a thinned axis from a shrunk one.
describe('labelStep — thin the axis instead of shrinking the type', () => {
  it('draws every label when the slot is comfortable', () => {
    expect(labelStep(MIN_LABEL_SLOT_PX)).toBe(1)
    expect(labelStep(80)).toBe(1)
  })

  it('draws every other label once the slot is too narrow', () => {
    expect(labelStep(MIN_LABEL_SLOT_PX - 1)).toBe(2)
    // Measured live: a nine-quarter axis is ~30px per slot inside
    // EarningsHistorySection's 58px-inset strip on a phone, and ~37px in the
    // phone sheet. Both must thin; the desktop ~79px slot must not.
    expect(labelStep(30)).toBe(2)
    expect(labelStep(37)).toBe(2)
    expect(labelStep(79)).toBe(1)
  })

  it('never returns 0 or a negative step for a degenerate slot', () => {
    // A 0 or NaN step would make `i % step` NaN and drop EVERY label, turning a
    // dense axis into an unlabelled one — silently, since no test renders SVG
    // text. Falling back to "draw everything" is the safe direction.
    for (const bad of [0, -5, null, undefined, NaN, 'x']) {
      expect(labelStep(bad)).toBe(1)
    }
  })

  it('the threshold is a real constant, not a magic number at the call site', () => {
    expect(MIN_LABEL_SLOT_PX).toBeGreaterThan(0)
    expect(labelStep(10, { min: 5 })).toBe(1)   // caller can override
    expect(labelStep(10, { min: 50 })).toBe(2)
  })
})
