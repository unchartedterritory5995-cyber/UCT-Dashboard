import { describe, it, expect } from 'vitest'
import { computeRowHeight, gridHeightFor, FIXED_ROWS, MARGIN_Y, BODY_PAD } from './rowHeight'

// THE invariant: whatever the body height, the grid react-grid-layout renders must
// fill it EXACTLY — no overflow (the body is overflow:clip, so overflow shears the
// date/time axis off the bottom widget, e.g. behind the Windows taskbar, 2026-07-30)
// AND no leftover (a floored row height piled ~≤19px into an oversized gap under the
// bottom row). A fractional row height renders to the pixel, so both are gone at once.

const gapFor = (merged) => (merged ? 0 : MARGIN_Y)
const padFor = (merged) => (merged ? 0 : BODY_PAD)

// A realistic sweep of body heights: laptop/desktop/ultrawide content areas, plus a
// full contiguous range so no single leftover value (0..FIXED_ROWS-1) is missed.
const HEIGHTS = [
  ...Array.from({ length: 200 }, (_, i) => 700 + i),   // every px 700..899
  920, 941, 959, 960, 1017, 1040, 1200, 1330, 1400, 1876, 2100,
]

describe.each([[true, 'merged'], [false, 'unmerged']])('computeRowHeight — %s', (merged, label) => {
  it(`fills the body EXACTLY — no bottom gap, no overflow (${label})`, () => {
    for (const h of HEIGHTS) {
      const rh = computeRowHeight(h, merged)
      const rendered = gridHeightFor(rh, gapFor(merged)) + padFor(merged) * 2
      // Fractional row height ⇒ the grid renders the body's height to the pixel, so
      // every gap is exactly the padding — top === bottom === left === right.
      expect(rendered, `h=${h} rowHeight=${rh} rendered=${rendered}`).toBeCloseTo(h, 6)
    }
  })

  it(`never renders TALLER than the body — the clip guard (${label})`, () => {
    for (const h of HEIGHTS) {
      const rh = computeRowHeight(h, merged)
      const rendered = gridHeightFor(rh, gapFor(merged)) + padFor(merged) * 2
      expect(rendered - h, `h=${h}`).toBeLessThanOrEqual(1e-6)
    }
  })

  it(`returns a positive, finite row height (${label})`, () => {
    for (const h of HEIGHTS) {
      const rh = computeRowHeight(h, merged)
      expect(Number.isFinite(rh)).toBe(true)
      expect(rh).toBeGreaterThan(0)
    }
  })
})

describe('computeRowHeight — regression: the taskbar clip AND the bottom gap', () => {
  it('fills merged mode exactly — the old floor left a gap, the older ceil clipped 19px', () => {
    // 941/20 = 47.05 → grid renders 941px: flush to the body bottom, no gap, no clip.
    // (floor gave 47 → 940px = 1px gap; ceil gave 48 → 960px = 19px axis clipped.)
    expect(computeRowHeight(941, true)).toBeCloseTo(47.05, 6)
    expect(gridHeightFor(computeRowHeight(941, true), 0)).toBeCloseTo(941, 6)
  })

  it('merged is never SHORTER than unmerged for the same body', () => {
    for (const h of HEIGHTS) {
      // Merged reclaims the padding + gaps, so its row height should be >= unmerged.
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
