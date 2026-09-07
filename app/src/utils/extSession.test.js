// Rails for getExtSession — the D/W/M "Include pre/post-market" toggle's
// session/anchorDate computation.
//
// Seam 6 (Chart Session / Extended-Hours Temporal Convergence, 2026-09-07):
// this file previously did not exist — getExtSession had ZERO direct test
// coverage despite driving StockChart.jsx's real extended-hours bars fetch
// (via anchorDate). Mirrors marketSession.intraday.test.js's own established
// fixed-clock convention (vi.useFakeTimers + vi.setSystemTime; safe here
// because this is a pure logic module, no React render/Testing Library
// involved). Time-mocked; Sep/Jul dates are EDT (UTC-4), Nov/Jan dates are
// EST (UTC-5).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getExtSession, getExtSessionCached, anchorNoonSec } from './extSession'

describe('getExtSession — ordinary trading days (regression: unchanged from before Seam 6)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('ordinary Monday 10:00 ET → rth, anchored today', () => {
    vi.setSystemTime(new Date('2026-09-14T14:00:00Z')) // Mon 10:00 EDT, not a holiday
    expect(getExtSession()).toEqual({ session: 'rth', anchorDate: '2026-09-14' })
  })

  it('ordinary Monday 05:00 ET → pre, anchored today', () => {
    vi.setSystemTime(new Date('2026-09-14T09:00:00Z'))
    expect(getExtSession()).toEqual({ session: 'pre', anchorDate: '2026-09-14' })
  })

  it('ordinary Friday 17:00 ET (after close) → post, anchored today', () => {
    vi.setSystemTime(new Date('2026-09-11T21:00:00Z')) // Fri 17:00 EDT
    expect(getExtSession()).toEqual({ session: 'post', anchorDate: '2026-09-11' })
  })
})

describe('getExtSession — weekend (regression: weekend-only walk-back still correct)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('Saturday → post, anchored to the prior Friday', () => {
    vi.setSystemTime(new Date('2026-09-12T16:00:00Z')) // Sat 12:00 EDT
    expect(getExtSession()).toEqual({ session: 'post', anchorDate: '2026-09-11' })
  })

  it('Sunday → post, anchored to the prior Friday', () => {
    vi.setSystemTime(new Date('2026-09-13T16:00:00Z')) // Sun 12:00 EDT
    expect(getExtSession()).toEqual({ session: 'post', anchorDate: '2026-09-11' })
  })
})

describe('getExtSession — NYSE holiday (Seam 6 fix: two confirmed defects closed)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('Labor Day (Mon 2026-09-07) 10:00 ET — WRONG SESSION SELECTION defect: no longer reads as rth', () => {
    vi.setSystemTime(new Date('2026-09-07T14:00:00Z'))
    // Before the fix this returned { session: 'rth', anchorDate: '2026-09-07' } —
    // claiming regular trading hours on a day the market is fully closed.
    expect(getExtSession()).toEqual({ session: 'post', anchorDate: '2026-09-04' })
  })

  it('Labor Day 17:00 ET (would-be post-close) — WRONG DATA REQUEST defect: anchor is the prior Friday, not the holiday', () => {
    vi.setSystemTime(new Date('2026-09-07T21:00:00Z'))
    // Before the fix: anchorDate: '2026-09-07' (the holiday itself).
    expect(getExtSession()).toEqual({ session: 'post', anchorDate: '2026-09-04' })
  })

  it('the day AFTER Labor Day, 02:00 ET (before 4am) — the SHARPEST defect: _prevTradingDay used to stop AT the holiday', () => {
    vi.setSystemTime(new Date('2026-09-08T06:00:00Z')) // Tue 02:00 EDT
    // Before the fix, _prevTradingDay walked back one day from Tuesday, landed
    // on Monday (not Sat/Sun, so the old loop stopped there), and returned
    // anchorDate: '2026-09-07' — the closed holiday, not the last real session.
    // StockChart.jsx feeds this into a real bars fetch + bar-time placement.
    expect(getExtSession()).toEqual({ session: 'post', anchorDate: '2026-09-04' })
  })

  it('the day after Labor Day, 05:00 ET (pre-market) — an ordinary trading day, unaffected', () => {
    vi.setSystemTime(new Date('2026-09-08T09:00:00Z'))
    expect(getExtSession()).toEqual({ session: 'pre', anchorDate: '2026-09-08' })
  })

  it('the day after Labor Day, 10:00 ET (rth) — an ordinary trading day, unaffected', () => {
    vi.setSystemTime(new Date('2026-09-08T14:00:00Z'))
    expect(getExtSession()).toEqual({ session: 'rth', anchorDate: '2026-09-08' })
  })

  it('a second, independent holiday (Independence Day observed, Fri 2026-07-03) confirms the fix is systemic, not Labor-Day-specific', () => {
    vi.setSystemTime(new Date('2026-07-03T14:00:00Z')) // Fri 10:00 EDT
    expect(getExtSession()).toEqual({ session: 'post', anchorDate: '2026-07-02' })
  })
})

describe('getExtSession — NYSE early close (Seam 6 fix: WRONG EXTENDED-HOURS TOGGLE defect closed)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('early-close day (Fri 2026-11-27) 12:00 ET, before the 1pm close — still rth', () => {
    vi.setSystemTime(new Date('2026-11-27T17:00:00Z')) // 12:00 EST
    expect(getExtSession()).toEqual({ session: 'rth', anchorDate: '2026-11-27' })
  })

  it('early-close day 14:00 ET, after the real 1pm close but before the old hardcoded 4pm threshold', () => {
    vi.setSystemTime(new Date('2026-11-27T19:00:00Z')) // 14:00 EST
    // Before the fix this returned { session: 'rth', ... } for 3 more hours —
    // the toggle read "regular session, inactive" while the market had
    // already closed and gone into post-market.
    expect(getExtSession()).toEqual({ session: 'post', anchorDate: '2026-11-27' })
  })
})

describe('getExtSession — outside nyseCalendar.js coverage (must degrade EXACTLY to prior weekday-only behavior)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('an ordinary weekday outside coverage (2027) still reads as rth — no throw, no guess, same as before Seam 6', () => {
    vi.setSystemTime(new Date('2027-01-04T15:00:00Z')) // Mon 10:00 EST, 2027 has no calendar table
    expect(getExtSession()).toEqual({ session: 'rth', anchorDate: '2027-01-04' })
  })

  it('a real 2025 holiday (Christmas) outside coverage is NOT recognized -- degrades honestly, exactly as before', () => {
    vi.setSystemTime(new Date('2025-12-25T15:00:00Z')) // Thu 10:00 EST, 2025 has no calendar table
    expect(getExtSession()).toEqual({ session: 'rth', anchorDate: '2025-12-25' })
  })
})

describe('getExtSessionCached — inherits holiday-awareness through the same underlying getExtSession', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a holiday-window read through the cached wrapper matches the direct call', () => {
    vi.setSystemTime(new Date('2026-09-07T14:00:00Z'))
    expect(getExtSessionCached()).toEqual({ session: 'post', anchorDate: '2026-09-04' })
  })
})

describe('anchorNoonSec — unchanged by Seam 6', () => {
  it('converts an anchor date to a stable unix-seconds noon-ET timestamp', () => {
    expect(anchorNoonSec('2026-09-04')).toBe(Math.floor(Date.parse('2026-09-04T16:00:00Z') / 1000))
  })
})
