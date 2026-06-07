import { describe, it, expect } from 'vitest'
import { reanchorLogicalRange } from './chartViewAnchor'

describe('reanchorLogicalRange', () => {
  it('keeps a right-edge view at the right edge when many older bars are prepended', () => {
    // Phase 1: 200 cached daily bars, user at the right edge (last ~65 bars).
    const oldRange = { from: 135, to: 203 } // 3-bar right padding => to > count
    // Phase 2: network full-fetch returns 5000 bars (4800 older bars prepended).
    const r = reanchorLogicalRange(200, oldRange, 5000)
    // Without re-anchoring, the numerically-preserved {135,203} would now sit
    // ~4800 bars back (≈ 2007). Re-anchoring must put the view back at the right.
    expect(r).not.toBeNull()
    expect(r.to).toBe(5003)   // newCount - barsFromRight (=-3) => stays pinned right
    expect(r.from).toBe(4935) // preserves the same 68-bar width
    // Sanity: the re-anchored range frames RECENT bars, not 2019.
    expect(r.from).toBeGreaterThan(4000)
  })

  it('preserves a deliberately scrolled-back view in DATE terms across a count change', () => {
    // User scrolled back to view ~bars 3300-3365 of a 5000-bar series.
    const oldRange = { from: 3300, to: 3365 }
    // A new session bar appends on the right => 5001 bars.
    const r = reanchorLogicalRange(5000, oldRange, 5001)
    expect(r).not.toBeNull()
    // bars-from-right (5000-3365=1635) is preserved => view does NOT yank to "now".
    expect(r.to).toBe(5001 - 1635) // 3366
    expect(r.to - r.from).toBe(65)
  })

  it('re-anchors correctly when the count SHRINKS (full set -> short IPO history)', () => {
    const oldRange = { from: 4935, to: 5003 } // right edge of 5000 bars
    const r = reanchorLogicalRange(5000, oldRange, 200) // switch to a 200-bar IPO
    expect(r).not.toBeNull()
    expect(r.to).toBe(203) // 200 - (-3) => still pinned to the right
    expect(r.to - r.from).toBe(68)
  })

  it('returns null on unusable inputs', () => {
    expect(reanchorLogicalRange(0, { from: 0, to: 10 }, 100)).toBeNull()
    expect(reanchorLogicalRange(100, null, 100)).toBeNull()
    expect(reanchorLogicalRange(100, { from: 0, to: 10 }, 0)).toBeNull()
  })

  it('returns null when width is non-positive', () => {
    expect(reanchorLogicalRange(100, { from: 50, to: 50 }, 200)).toBeNull()
  })
})
