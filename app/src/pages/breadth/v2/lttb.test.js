/**
 * V2-3 rails — the LTTB threshold decision.
 *
 * ⚰️ This file previously tested a hand-rolled bucket algorithm (never synthesised a
 * value, one shared index set, nulls preserved, etc). That algorithm was thrown away —
 * see the module doc in `lttb.js` — because the installed ECharts (6.0.0) already
 * implements LTTB natively for both line and bar series, applied at render time without
 * ever touching the shared category axis. What remains to test is the ONE decision this
 * module still owns: above what point count is turning it on worth it.
 */
import { describe, it, expect } from 'vitest'
import { shouldSample, THRESHOLD_POINTS } from './lttb'

describe('the threshold', () => {
  it('is 4x the measured mobile viewport width (380px) — see D-053', () => {
    expect(THRESHOLD_POINTS).toBe(1500)
  })

  it('does not sample AT the threshold, samples one point OVER it', () => {
    expect(shouldSample(THRESHOLD_POINTS)).toBe(false)
    expect(shouldSample(THRESHOLD_POINTS + 1)).toBe(true)
  })

  it('handles the edges without throwing', () => {
    expect(shouldSample(0)).toBe(false)
    expect(shouldSample(undefined)).toBe(false)
    expect(shouldSample(null)).toBe(false)
  })

  it('the default (90-365 sessions) never crosses it', () => {
    // ⭐ The property that makes LTTB structurally inert until L-A raises the cap: the
    // client's own MAX_SESSIONS (365 calendar days) sits nowhere near this threshold.
    expect(shouldSample(365)).toBe(false)
  })

  it('the full stored history (D-053\'s measured ceiling) DOES cross it', () => {
    expect(shouldSample(4530)).toBe(true)
  })
})
