// Rails for isDailyTailStaleForPaint — the OPEN-anchored daily paint gate that
// pairs with the server-include of today's developing daily bar (api/routers/
// bars.py). It must diverge from isDailyTailStale (close-anchored) ONLY inside
// RTH: a yesterday-ending cache is fresh to the warmer but STALE to paint mid-
// session, because the network response now carries today and painting yesterday
// first causes the "current candle loads one bar right, then pops left" shift.
// Time-mocked (EDT = UTC-4 in Sep 2026). Wed 2026-09-02, prior sessions Mon 8/31 + Tue 9/1.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isDailyTailStaleForPaint, isDailyTailStale, isDailyTodayCloseProvisionalForPaint,
  expectedLatestDailySessionET,
} from './marketSession'

describe('isDailyTailStaleForPaint', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  describe('Wednesday 11:00 ET (RTH)', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-09-02T15:00:00Z'))) // Wed 11:00 EDT

    it('STALE-for-paint: tail = yesterday (Tue) — missing today, would shift', () => {
      expect(isDailyTailStaleForPaint('2026-09-01')).toBe(true)
      // …while the close-anchored gate still calls it fresh (the divergence).
      expect(isDailyTailStale('2026-09-01')).toBe(false)
    })
    it('FRESH: tail = today (Wed) — the server-included developing bar', () => {
      expect(isDailyTailStaleForPaint('2026-09-02')).toBe(false)
    })
    it('STALE: tail = an earlier closed session (Mon) — both gates agree', () => {
      expect(isDailyTailStaleForPaint('2026-08-31')).toBe(true)
      expect(isDailyTailStale('2026-08-31')).toBe(true)
    })
  })

  describe('Wednesday 16:30 ET (post-close) — both gates expect today', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-09-02T20:30:00Z')))
    it('yesterday is stale to BOTH; today is fresh to both', () => {
      expect(isDailyTailStaleForPaint('2026-09-01')).toBe(true)
      expect(isDailyTailStale('2026-09-01')).toBe(true)
      expect(isDailyTailStaleForPaint('2026-09-02')).toBe(false)
    })
  })

  describe('Wednesday 08:00 ET (pre-open) — server has no today yet, last closed = Tue', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-09-02T12:00:00Z')))
    it('a Tuesday tail is FRESH to both (paint gate must NOT over-refetch pre-market)', () => {
      expect(isDailyTailStaleForPaint('2026-09-01')).toBe(false)
      expect(isDailyTailStale('2026-09-01')).toBe(false)
    })
    it('an earlier session (Mon) is stale to both', () => {
      expect(isDailyTailStaleForPaint('2026-08-31')).toBe(true)
    })
  })

  it('non-string / empty tail is not stale (matches isDailyTailStale)', () => {
    vi.setSystemTime(new Date('2026-09-02T15:00:00Z'))
    expect(isDailyTailStaleForPaint(null)).toBe(false)
    expect(isDailyTailStaleForPaint('')).toBe(false)
    expect(isDailyTailStaleForPaint(undefined)).toBe(false)
  })
})

describe('isDailyTodayCloseProvisionalForPaint (after-hours sealed-close flicker)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('post-close (Wed 16:30): a TODAY tail is provisional → defer to the sealed close', () => {
    vi.setSystemTime(new Date('2026-09-02T20:30:00Z'))
    expect(isDailyTodayCloseProvisionalForPaint('2026-09-02')).toBe(true)
    // a yesterday tail is NOT this case (the date gate owns it), and a non-today date is false
    expect(isDailyTodayCloseProvisionalForPaint('2026-09-01')).toBe(false)
  })

  it('during RTH (Wed 11:00): a TODAY tail is NOT provisional — the bar legitimately evolves', () => {
    vi.setSystemTime(new Date('2026-09-02T15:00:00Z'))
    expect(isDailyTodayCloseProvisionalForPaint('2026-09-02')).toBe(false)
  })

  it('pre-open (Wed 08:00): not post-close → false', () => {
    vi.setSystemTime(new Date('2026-09-02T12:00:00Z'))
    expect(isDailyTodayCloseProvisionalForPaint('2026-09-02')).toBe(false)
  })

  it('null / empty tail → false', () => {
    vi.setSystemTime(new Date('2026-09-02T20:30:00Z'))
    expect(isDailyTodayCloseProvisionalForPaint(null)).toBe(false)
    expect(isDailyTodayCloseProvisionalForPaint('')).toBe(false)
  })

  // Temporal / Freshness Truth Convergence V1 — real NYSE early-close day
  // (Day after Thanksgiving 2026-11-27, real close 13:00 ET, EST = UTC-5).
  describe('a real NYSE early-close day (Fri 2026-11-27, sealed close = 13:00 ET)', () => {
    it('before the real 13:00 close (11:00 ET): not provisional yet', () => {
      vi.setSystemTime(new Date('2026-11-27T16:00:00Z')) // 11:00 EST
      expect(isDailyTodayCloseProvisionalForPaint('2026-11-27')).toBe(false)
    })

    it('after the real 13:00 close but before the old hardcoded 16:00 (14:00 ET): NOW provisional — the fix', () => {
      vi.setSystemTime(new Date('2026-11-27T19:00:00Z')) // 14:00 EST
      expect(isDailyTodayCloseProvisionalForPaint('2026-11-27')).toBe(true)
    })

    it('after 16:00 ET too: still provisional (regression guard)', () => {
      vi.setSystemTime(new Date('2026-11-27T22:00:00Z')) // 17:00 EST
      expect(isDailyTodayCloseProvisionalForPaint('2026-11-27')).toBe(true)
    })
  })
})

describe('expectedLatestDailySessionET — S11 holiday/early-close awareness (Temporal / Freshness Truth Convergence V1)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('NYSE holiday itself, before its own (assumed) close (MLK Mon 2026-01-19, 10:00 ET) → last real trading day (Fri 2026-01-16)', () => {
    vi.setSystemTime(new Date('2026-01-19T15:00:00Z')) // 10:00 EST
    expect(expectedLatestDailySessionET()).toBe('2026-01-16')
  })

  it('NYSE holiday itself, after its own (assumed) close (MLK Mon 2026-01-19, 17:00 ET) → still Fri 2026-01-16, NOT the holiday date itself', () => {
    vi.setSystemTime(new Date('2026-01-19T22:00:00Z')) // 17:00 EST
    expect(expectedLatestDailySessionET()).toBe('2026-01-16')
  })

  it('day AFTER a holiday, before its own close (Tue 2026-01-20, 10:00 ET) → last real trading day (Fri 2026-01-16), not the holiday Monday', () => {
    vi.setSystemTime(new Date('2026-01-20T15:00:00Z')) // 10:00 EST
    expect(expectedLatestDailySessionET()).toBe('2026-01-16')
  })

  it('day AFTER a holiday, after its own close (Tue 2026-01-20, 17:00 ET) → today', () => {
    vi.setSystemTime(new Date('2026-01-20T22:00:00Z')) // 17:00 EST
    expect(expectedLatestDailySessionET()).toBe('2026-01-20')
  })

  it('backward walk skips through an adjacent full-holiday session (day after Thanksgiving, Fri 2026-11-27, 11:00 ET) → Wed 2026-11-25 (skips Thu 11/26 Thanksgiving)', () => {
    vi.setSystemTime(new Date('2026-11-27T16:00:00Z')) // 11:00 EST, before this day's own 13:00 early close
    expect(expectedLatestDailySessionET()).toBe('2026-11-25')
  })

  it('real early-close day, after its 13:00 close but before the old hardcoded 16:00 (Fri 2026-11-27, 14:00 ET) → today — the half-day threshold fix', () => {
    vi.setSystemTime(new Date('2026-11-27T19:00:00Z')) // 14:00 EST
    expect(expectedLatestDailySessionET()).toBe('2026-11-27')
  })

  it('real early-close day, before its own 13:00 close (Christmas Eve 2026-12-24, 11:00 ET) → previous real trading day (Wed 2026-12-23)', () => {
    vi.setSystemTime(new Date('2026-12-24T16:00:00Z')) // 11:00 EST
    expect(expectedLatestDailySessionET()).toBe('2026-12-23')
  })

  it('combined weekend + adjacent holiday (Mon 2026-07-06, 10:00 ET, following the Fri 2026-07-03 observed-Independence-Day closure) → walks past BOTH the holiday and the weekend to Thu 2026-07-02', () => {
    vi.setSystemTime(new Date('2026-07-06T14:00:00Z')) // 10:00 EDT
    expect(expectedLatestDailySessionET()).toBe('2026-07-02')
  })

  it('outside calendar coverage (a 2027 date, no real table): degrades to weekday-only behavior — a real MLK-day-equivalent Monday is NOT treated as a holiday', () => {
    // 2027-01-18 is a Monday with no entry in nyseCalendar's 2026-only table.
    vi.setSystemTime(new Date('2027-01-18T22:00:00Z')) // 17:00 EST, after the ordinary 16:00 close
    expect(expectedLatestDailySessionET()).toBe('2027-01-18')
  })
})
