/**
 * NEXT-ROW KEY TASK HELPERS, ITEM (1b): THE SESSION CALENDAR'S WEEKDAY, ONCE PER DATE (2026-11-23).
 *
 * `isTradingDay` asked `new Date(`${iso}T00:00:00Z`).getUTCDay()` on every call (0.63 ms a next-row press, profiled:
 * day walks such as `otherSymbols.sessionsSpanned`, one call per calendar day an intraday chart spans).
 *   S1 isTradingDay answers what it did (the weekday as the Date parse reads it, and the holiday table) for every day
 *      1990-2035, and for strings that are not dates (an impossible day, a month 13, an unpadded date, garbage)
 *   S2 a day asked twice is parsed once (red before the change)
 */
import { describe, it, expect, vi } from 'vitest'
import { isTradingDay, holidayName } from './sessionCalendar'

// the reference: isTradingDay as it was (8d50b2813f), the holiday half read through the module's own table
const refIsTradingDay = (k) => {
  const wd = new Date(`${k}T00:00:00Z`).getUTCDay()
  return wd !== 0 && wd !== 6 && holidayName(k) == null
}
const days = (from, to) => {
  const out = []
  for (let t = Date.UTC(...from); t <= Date.UTC(...to); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

describe('the session calendar\'s weekday', () => {
  it('S1 every day 1990-2035, and strings that are not dates, answer as before', () => {
    const all = days([1990, 0, 1], [2035, 11, 31])
    expect(all.length).toBeGreaterThan(16_000)
    for (const k of all) if (isTradingDay(k) !== refIsTradingDay(k)) expect([k, isTradingDay(k)]).toEqual([k, refIsTradingDay(k)])
    for (const k of all) if (isTradingDay(k) !== refIsTradingDay(k)) expect([k, 'second pass']).toEqual([k, refIsTradingDay(k)])
    for (const odd of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-11-31', '9999-12-31', '0001-01-01']) {
      let got, want
      try { got = isTradingDay(odd) } catch (e) { got = `throws ${e?.constructor?.name}` }
      try { want = refIsTradingDay(odd) } catch (e) { want = `throws ${e?.constructor?.name}` }
      expect([odd, got]).toEqual([odd, want])
    }
  })

  it('S2 a day asked twice is parsed once', () => {
    const some = days([2001, 0, 1], [2003, 11, 31])
    for (const k of some) isTradingDay(k)                // first pass
    const spy = vi.spyOn(Date.prototype, 'getUTCDay')
    let n = -1
    try {
      for (const k of some) isTradingDay(k)              // the same days again
      n = spy.mock.calls.length                          // read BEFORE mockRestore, which resets it
    } finally { spy.mockRestore() }
    expect(n).toBe(0)
  })
})
