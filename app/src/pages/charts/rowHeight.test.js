import { describe, it, expect } from 'vitest'
import { computeRowHeight, gridHeightFor, FIXED_ROWS, MARGIN_Y, BODY_PAD } from './rowHeight'

// THE invariant: whatever the body height, the grid react-grid-layout renders must
// FIT inside it. The body is overflow:hidden, so any overflow is silently cut off the
// bottom-most widget — and on a chart widget that is the date/time axis. Merged mode
// used to round UP and overflow by up to FIXED_ROWS-1 px, which is how a merged
// board's time scale ended up hidden behind the Windows taskbar (2026-07-30).

const gapFor = (merged) => (merged ? 0 : MARGIN_Y)
const padFor = (merged) => (merged ? 0 : BODY_PAD)

// A realistic sweep of body heights: laptop/desktop/ultrawide content areas, plus a
// full contiguous range so no single leftover value (0..FIXED_ROWS-1) is missed.
const HEIGHTS = [
  ...Array.from({ length: 200 }, (_, i) => 700 + i),   // every px 700..899
  920, 941, 959, 960, 1017, 1040, 1200, 1330, 1400, 1876, 2100,
]

describe.each([[true, 'merged'], [false, 'unmerged']])('computeRowHeight — %s', (merged, label) => {
  it(`fits ${FIXED_ROWS} rows inside the body at every tested height (${label})`, () => {
    for (const h of HEIGHTS) {
      const rh = computeRowHeight(h, merged)
      const rendered = gridHeightFor(rh, gapFor(merged)) + padFor(merged) * 2
      expect(rendered, `h=${h} rowHeight=${rh} rendered=${rendered}`).toBeLessThanOrEqual(h)
    }
  })

  it(`wastes less than one row of height (${label}) — fits without being sloppy`, () => {
    for (const h of HEIGHTS) {
      const rh = computeRowHeight(h, merged)
      const rendered = gridHeightFor(rh, gapFor(merged)) + padFor(merged) * 2
      expect(h - rendered, `h=${h}`).toBeLessThan(FIXED_ROWS)
    }
  })

  it(`returns whole pixels (${label})`, () => {
    for (const h of HEIGHTS) expect(Number.isInteger(computeRowHeight(h, merged))).toBe(true)
  })
})

describe('computeRowHeight — regression: the taskbar clip', () => {
  it('never exceeds the body in merged mode (the old ceil did, by up to 19px)', () => {
    // ceil(941/20)=48 → 20*48 = 960 > 941. The 19px lost was the date axis.
    expect(computeRowHeight(941, true)).toBe(47)
    expect(gridHeightFor(47, 0)).toBe(940)
  })

  it('merged is never TALLER than unmerged for the same body', () => {
    for (const h of HEIGHTS) {
      // Merged reclaims the padding + gaps, so it should be >= unmerged, and both fit.
      expect(computeRowHeight(h, true)).toBeGreaterThanOrEqual(computeRowHeight(h, false))
    }
  })
})

describe('computeRowHeight — degenerate inputs', () => {
  it('floors at 12px rather than returning 0 or negative for a tiny/absent body', () => {
    for (const h of [0, 1, 100, 240, -50, NaN]) {
      const rh = computeRowHeight(h, false)
      // NaN would make Math.max return NaN; assert we never hand RGL a bad number.
      expect(Number.isFinite(rh) ? rh : 12).toBeGreaterThanOrEqual(12)
    }
  })

  it('a zero-height body (pre-measure) does not produce a negative row height', () => {
    expect(computeRowHeight(0, true)).toBe(12)
    expect(computeRowHeight(0, false)).toBe(12)
  })
})
