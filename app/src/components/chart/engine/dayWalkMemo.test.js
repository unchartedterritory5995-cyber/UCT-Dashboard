/**
 * SMOOTHNESS PART 2, ITEM (a): THE OTHER-SYMBOL DAY WALKS, ONCE PER DAY (2026-11-26).
 *
 * Trace (local dist 4bc325e4ae, 5m+60m board, 5 traced switches): `nextDayOf` (otherSymbols.js, a template string, a
 * `Date.parse`, a `Date` and an ISO string per calendar day) was 3.1-4.7 ms of a 23-28 ms main-thread task in the second
 * after both charts showed the new symbol, from the day walks `sessionsSpanned` (StockChart's held-session count) and
 * `atOrBeforeGridOf` (the RS index grid). The day after a day never changes, and neither does the trading-session count of
 * a span of days, so both are kept.
 *   S1 sessionsSpanned answers what it did (the reference below is the code as it was, ed7605b405) for spans across
 *      DST changes, ET midnight, year ends and leap days, for a span longer than the walk's 40,000-day cap, for anything
 *      that is not two ascending unix seconds, and again on a second pass (kept answers)
 *   S2 the same span asked again parses no date (red before the change)
 *   S3 a NEW span over days already walked parses no date (red before the change: the day after a day is kept)
 *   S4 the same span asked again asks the calendar nothing (red without the kept span count)
 */
import { describe, it, expect, vi } from 'vitest'
import { sessionsSpanned } from './otherSymbols'
import { isTradingDay } from '../../../lib/marketClock/sessionCalendar.js'

// the reference: sessionsSpanned as it was (ed7605b405)
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
const refDayOf = (t) => FMT.format(new Date(t * 1000))
const refNextDayOf = (day) => new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
function refSessionsSpanned(firstT, lastT) {
  if (typeof firstT !== 'number' || typeof lastT !== 'number' || !Number.isFinite(firstT) || !(lastT >= firstT)) return 0
  const a = refDayOf(firstT)
  const b = refDayOf(lastT)
  let count = 0
  for (let d = a, k = 0; d <= b && k < 40000; d = refNextDayOf(d), k += 1) if (isTradingDay(d)) count += 1
  return count
}

const at = (iso) => Date.parse(iso) / 1000
const answer = (fn, a, b) => { try { return fn(a, b) } catch (e) { return `throws ${e?.constructor?.name}` } }

describe('the other-symbol day walks', () => {
  it('S1 sessionsSpanned answers as before, twice', () => {
    const pairs = [
      // a DST change inside the span, and on each edge (2026-03-08 02:00 EST -> EDT; 2026-11-01 02:00 EDT -> EST)
      [at('2026-03-06T15:00:00Z'), at('2026-03-10T15:00:00Z')],
      [at('2026-03-08T06:59:59Z'), at('2026-03-08T07:00:00Z')],
      [at('2026-10-30T15:00:00Z'), at('2026-11-03T15:00:00Z')],
      [at('2026-11-01T05:59:59Z'), at('2026-11-01T06:00:00Z')],
      // ET midnight on each edge (04:00Z in EDT, 05:00Z in EST)
      [at('2026-07-06T03:59:59Z'), at('2026-07-07T04:00:00Z')],
      [at('2026-11-24T04:59:59Z'), at('2026-11-25T05:00:00Z')],
      // year ends, a leap day, a holiday, one bar, a fractional second
      [at('2023-12-29T14:30:00Z'), at('2024-01-02T14:30:00Z')],
      [at('2024-02-28T14:30:00Z'), at('2024-03-01T14:30:00Z')],
      [at('2026-11-26T15:00:00Z'), at('2026-11-26T15:00:00Z')],
      [at('2026-11-25T14:30:00Z') + 0.5, at('2026-11-27T18:00:00Z') + 0.25],
      // a deep 60m history (2005 to today) and a span past the walk's 40,000-day cap
      [at('2005-01-03T14:30:00Z'), at('2026-11-25T20:00:00Z')],
      [0, at('2200-01-01T00:00:00Z')],
      // not two ascending unix seconds
      [at('2026-11-25T14:30:00Z'), at('2026-11-24T14:30:00Z')],
      [NaN, at('2026-11-24T14:30:00Z')], [at('2026-11-24T14:30:00Z'), Infinity], ['2026-11-01', '2026-11-25'],
      [null, at('2026-11-24T14:30:00Z')], [undefined, undefined],
    ]
    // and seeded random spans of up to ~6 years, 1999-2031
    let seed = 20261126
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let i = 0; i < 60; i += 1) {
      const a = at('1999-01-01T00:00:00Z') + Math.floor(rnd() * 32 * 365 * 86400)
      pairs.push([a, a + Math.floor(rnd() * 6 * 365 * 86400)])
    }
    for (const pass of ['first', 'second']) {
      for (const [a, b] of pairs) {
        const got = answer(sessionsSpanned, a, b)
        const want = answer(refSessionsSpanned, a, b)
        if (got !== want) expect([pass, a, b, got]).toEqual([pass, a, b, want])
      }
    }
  })

  it('S2 the same span asked again parses no date', () => {
    const a = at('2008-01-02T14:30:00Z'), b = at('2019-06-28T19:00:00Z')
    const first = sessionsSpanned(a, b)
    const spy = vi.spyOn(Date, 'parse')
    let n = -1, again
    try {
      again = sessionsSpanned(a, b)
      n = spy.mock.calls.length                  // read BEFORE mockRestore, which resets it
    } finally { spy.mockRestore() }
    expect(again).toBe(first)
    expect(n).toBe(0)
  })

  it('S3 a new span over days already walked parses no date', () => {
    const a = at('1993-01-04T14:30:00Z'), b = at('2001-12-31T19:00:00Z')
    sessionsSpanned(a, b)                        // walks every day 1993-01-04 .. 2001-12-31
    const spy = vi.spyOn(Date, 'parse')
    let n = -1, got
    try {
      got = sessionsSpanned(a + 86400 * 3, b)    // another span, the same days less three
      n = spy.mock.calls.length
    } finally { spy.mockRestore() }
    expect(got).toBe(refSessionsSpanned(a + 86400 * 3, b))
    expect(n).toBe(0)
  })

  it('S4 the same span asked again asks the calendar nothing (its count is kept)', () => {
    // isTradingDay checks each day's string with a RegExp (`sessionCalendar._dayKey`): a walk tests one per day
    const a = at('2010-03-01T14:30:00Z'), b = at('2016-09-30T19:00:00Z')
    const first = sessionsSpanned(a, b)
    const spy = vi.spyOn(RegExp.prototype, 'test')
    let n = -1, again
    try {
      again = sessionsSpanned(a, b)
      n = spy.mock.calls.length
    } finally { spy.mockRestore() }
    expect(again).toBe(first)
    expect(n).toBe(0)
  })
})
