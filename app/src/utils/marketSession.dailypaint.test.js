// Rails for isDailyTailStaleForPaint — the OPEN-anchored daily paint gate that
// pairs with the server-include of today's developing daily bar (api/routers/
// bars.py). It must diverge from isDailyTailStale (close-anchored) ONLY inside
// RTH: a yesterday-ending cache is fresh to the warmer but STALE to paint mid-
// session, because the network response now carries today and painting yesterday
// first causes the "current candle loads one bar right, then pops left" shift.
// Time-mocked (EDT = UTC-4 in Sep 2026). Wed 2026-09-02, prior sessions Mon 8/31 + Tue 9/1.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isDailyTailStaleForPaint, isDailyTailStale } from './marketSession'

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
