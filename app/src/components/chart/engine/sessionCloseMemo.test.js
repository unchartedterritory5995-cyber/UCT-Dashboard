// ─── ⭐ PERF (Fred RS 5m profile, 2026-11-19) — `otherSymbols.js::sessionCloseOf` ANSWERS ONCE PER DAY ───
//
// The run's supply asked the regular-session close once PER CHART BAR (`requestSupply.js::aboveChartRead`), each a
// `Intl.DateTimeFormat` call: 62 ms of Fred RS's run half at 2,000 5m bars. It is a pure function of the ISO day
// (the exchange calendar is static data), so it is memoized per day. These rails hold the memo to the calendar's own
// answer (a regular day, a half-day, a holiday, a weekend) and prove it is consulted (one entry per DAY, not per call).
import { describe, it, expect, beforeEach } from 'vitest'
import { sessionCloseOf, __sessionCloseMemoSizeForTests } from './otherSymbols'
import { closeTime } from '../../../lib/marketClock/sessionCalendar.js'

beforeEach(() => { __sessionCloseMemoSizeForTests(true) })

const direct = (day) => { const c = closeTime(day); return c ? c.getTime() / 1000 : null }

describe('sessionCloseOf: the calendar\'s answer, once per day', () => {
  it('equals the calendar on a regular day, a half-day, a holiday and a weekend (first call and memoized call)', () => {
    for (const day of ['2026-11-18', '2026-11-27', '2026-11-26', '2026-11-21', '2026-03-09', '2026-11-02']) {
      const first = sessionCloseOf(day)
      expect(first, day).toBe(direct(day))
      expect(sessionCloseOf(day), `${day} (memoized)`).toBe(first)
    }
    // the half-day closes at 13:00 ET (18:00Z in EST), a regular day at 16:00 ET (21:00Z)
    expect(sessionCloseOf('2026-11-27')).toBe(Date.UTC(2026, 10, 27, 18, 0) / 1000)
    expect(sessionCloseOf('2026-11-18')).toBe(Date.UTC(2026, 10, 18, 21, 0) / 1000)
    expect(sessionCloseOf('2026-11-26')).toBeNull()   // Thanksgiving
    expect(sessionCloseOf('2026-11-21')).toBeNull()   // Saturday
  })

  it('a chart\'s worth of bars asks the calendar once per DAY: 2,000 calls over 14 sessions hold 14 entries', () => {
    const days = []
    for (let d = 3; days.length < 14; d += 1) {
      const iso = `2026-11-${String(d).padStart(2, '0')}`
      if (direct(iso) !== null) days.push(iso)
    }
    for (let i = 0; i < 2000; i += 1) sessionCloseOf(days[i % days.length])
    expect(__sessionCloseMemoSizeForTests()).toBe(days.length)
  })

  it('a malformed day still throws (never cached as an answer)', () => {
    expect(() => sessionCloseOf('2026/11/18')).toThrow(/expected YYYY-MM-DD/)
    expect(__sessionCloseMemoSizeForTests()).toBe(0)
  })
})
