// Rails for the two daily first-paint primitives added for the DAILY FIRST-PAINT
// fix: how many sessions a tail is behind, and whether a TODAY-dated bar is old
// enough that painting it would show the member stale numbers.
//
// Time-mocked (EDT = UTC-4 in Sep 2026), same convention as
// marketSession.dailypaint.test.js. The anchor day is Wed 2026-09-09 because the
// session walk back from it crosses LABOR DAY (Mon 2026-09-07) — the one shape a
// calendar-blind weekday walk gets wrong.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  dailySessionsMissingForPaint,
  dailyMissingSessionsForPaint,
  isDailyTodayBarStaleForPaint,
  expectedDailyTailForPaintET,
  DAILY_TODAY_MAX_AGE_MS,
} from './marketSession'

const RTH_WED = new Date('2026-09-09T15:00:00Z')   // Wed 2026-09-09 11:00 EDT

describe('dailySessionsMissingForPaint', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(RTH_WED) })
  afterEach(() => vi.useRealTimers())

  it('the paint frontier during RTH is today', () => {
    expect(expectedDailyTailForPaintET()).toBe('2026-09-09')
  })

  it('a tail at the frontier is missing nothing', () => {
    expect(dailySessionsMissingForPaint('2026-09-09')).toBe(0)
  })

  it('one session behind = 1', () => {
    expect(dailySessionsMissingForPaint('2026-09-08')).toBe(1)
  })

  // DISCRIMINATING: Mon 2026-09-07 is Labor Day. A weekday-only walk back from
  // Wed 09-09 lands on 09-07 at k=2 and would answer 3 for a 09-04 tail. The NYSE
  // calendar answers 2. A calendar-blind implementation reds on both lines.
  it('skips an NYSE full holiday (Labor Day, Mon 2026-09-07)', () => {
    expect(dailySessionsMissingForPaint('2026-09-04')).toBe(2)
    expect(dailySessionsMissingForPaint('2026-09-07')).toBe(2)   // the closure itself is not a session
  })

  it('skips weekends: Fri 09-04 -> Thu 09-03 -> Wed 09-02', () => {
    expect(dailySessionsMissingForPaint('2026-09-03')).toBe(3)
    expect(dailySessionsMissingForPaint('2026-09-02')).toBe(4)
    expect(dailySessionsMissingForPaint('2026-09-01')).toBe(5)
  })

  // The framing reserve and the whitespace seed both consume THIS list, so its
  // contents — not just its length — are load-bearing: a reserve of n against a
  // seed of m lands the first frame off by (n - m).
  it('returns the missing session DATES, ascending, ending at the frontier', () => {
    expect(dailyMissingSessionsForPaint('2026-09-08')).toEqual(['2026-09-09'])
    expect(dailyMissingSessionsForPaint('2026-09-04')).toEqual(['2026-09-08', '2026-09-09'])
    expect(dailyMissingSessionsForPaint('2026-09-02')).toEqual(['2026-09-03', '2026-09-04', '2026-09-08', '2026-09-09'])
    expect(dailyMissingSessionsForPaint('2026-09-09')).toEqual([])
  })

  it('is bounded by cap — a years-old tail costs O(cap), never O(years)', () => {
    expect(dailySessionsMissingForPaint('2015-01-02', 8)).toBe(8)
    expect(dailySessionsMissingForPaint('2015-01-02', 2)).toBe(2)
  })

  it('a future or malformed tail is missing nothing', () => {
    expect(dailySessionsMissingForPaint('2099-01-01')).toBe(0)
    expect(dailySessionsMissingForPaint(null)).toBe(0)
    expect(dailySessionsMissingForPaint('')).toBe(0)
  })

  // Outside RTH the frontier is the last CLOSED session, so a yesterday tail is
  // complete — the count must follow the frontier, not the calendar date.
  it('follows the frontier outside RTH (pre-open Wed: frontier is Tue)', () => {
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))   // 08:00 EDT, pre-open
    expect(expectedDailyTailForPaintET()).toBe('2026-09-08')
    expect(dailySessionsMissingForPaint('2026-09-08')).toBe(0)
    expect(dailySessionsMissingForPaint('2026-09-04')).toBe(1)
  })
})

describe('isDailyTodayBarStaleForPaint', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(RTH_WED) })
  afterEach(() => vi.useRealTimers())

  it('a today bar written just now is current', () => {
    expect(isDailyTodayBarStaleForPaint('2026-09-09', Date.now())).toBe(false)
  })

  it('a today bar just inside the accepted seed ceiling is current', () => {
    expect(isDailyTodayBarStaleForPaint('2026-09-09', Date.now() - (DAILY_TODAY_MAX_AGE_MS - 1000))).toBe(false)
  })

  // THE GAP THIS CLOSES: this is the 10:05-written bar being painted at 11:00.
  it('a today bar written hours ago is NOT current', () => {
    expect(isDailyTodayBarStaleForPaint('2026-09-09', Date.now() - 3 * 3600_000)).toBe(true)
  })

  it('an unknown write time is never treated as current', () => {
    expect(isDailyTodayBarStaleForPaint('2026-09-09', null)).toBe(true)
    expect(isDailyTodayBarStaleForPaint('2026-09-09', 0)).toBe(true)
  })

  it('a non-today tail is not this gate\'s business — the session gate owns it', () => {
    expect(isDailyTodayBarStaleForPaint('2026-09-08', 0)).toBe(false)
  })

  // Scope rails: before the open there is no developing bar, and at/after the close
  // isDailyTodayCloseProvisionalForPaint already owns the window. Widening this gate
  // into those hours would defer paints that are legitimately settled.
  it('is inert pre-open and post-close', () => {
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))   // 08:00 EDT
    expect(isDailyTodayBarStaleForPaint('2026-09-09', 0)).toBe(false)
    vi.setSystemTime(new Date('2026-09-09T21:00:00Z'))   // 17:00 EDT
    expect(isDailyTodayBarStaleForPaint('2026-09-09', 0)).toBe(false)
  })

  it('is inert on a weekend', () => {
    vi.setSystemTime(new Date('2026-09-12T15:00:00Z'))   // Sat
    expect(isDailyTodayBarStaleForPaint('2026-09-12', 0)).toBe(false)
  })
})
