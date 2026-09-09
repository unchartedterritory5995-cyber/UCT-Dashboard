import { describe, it, expect } from 'vitest'
import { labelStep, MIN_LABEL_SLOT_PX, compactQuarter, fmtMove } from './format'

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

describe('compactQuarter', () => {
  it('shortens the fiscal form the Company Panel sends', () => {
    expect(compactQuarter('FY2026 Q3')).toBe("Q3 '26")
    expect(compactQuarter('FY2025 Q1')).toBe("Q1 '25")
  })

  it('keeps the year, because a strip spans a fiscal boundary', () => {
    // Bare "Q3, Q4, Q1, Q2" would repeat across years and read as nonsense.
    const labels = ['FY2025 Q3', 'FY2025 Q4', 'FY2026 Q1'].map(compactQuarter)
    expect(new Set(labels).size).toBe(3)
    labels.forEach(l => expect(l).toMatch(/'\d{2}$/))
  })

  it('is materially shorter than the full form', () => {
    expect(compactQuarter('FY2026 Q3').length)
      .toBeLessThan('FY2026 Q3'.length - 2)
  })

  it('handles loose orderings', () => {
    expect(compactQuarter('Q3 2026')).toBe("Q3 '26")
    expect(compactQuarter('2026 Q3')).toBe("Q3 '26")
  })

  it('leaves anything that is not a fiscal quarter alone', () => {
    // Reaction rows fall back to a raw report DATE when a label is missing;
    // mangling that would be worse than a wide label.
    expect(compactQuarter('2026-06-30')).toBe('2026-06-30')
    expect(compactQuarter('')).toBe('')
    expect(compactQuarter(null)).toBe('')
    expect(compactQuarter(undefined)).toBe('')
  })

  it('does not invent a quarter that was not there', () => {
    expect(compactQuarter('FY2026')).toBe('FY2026')
  })
})

describe('fmtMove', () => {
  it('keeps a decimal only where it carries the magnitude', () => {
    expect(fmtMove(2.6)).toBe('+2.6%')     // "+3%" would lose the whole point
    expect(fmtMove(18.1)).toBe('+18%')     // the decimal is noise at this size
  })

  it('marks direction, using a real minus sign', () => {
    expect(fmtMove(-13.31)).toBe('−13%')
    expect(fmtMove(-4.66)).toBe('−4.7%')
  })

  it('does not sign a flat move', () => {
    expect(fmtMove(0)).toBe('0.0%')
  })

  it('is short enough for a ~48px slot', () => {
    for (const v of [-3457.6, 18.1, -0.4, 100]) {
      expect(fmtMove(v).length).toBeLessThanOrEqual(8)
    }
  })

  it('returns empty for a gap rather than inventing a zero', () => {
    expect(fmtMove(null)).toBe('')
    expect(fmtMove(undefined)).toBe('')
    expect(fmtMove(NaN)).toBe('')
  })
})
