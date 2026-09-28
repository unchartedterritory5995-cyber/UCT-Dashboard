/**
 * ⛔⛔ PREVIOUS-SESSION DATA CAN NEVER SILENTLY SATISFY AN ACTIVE-SESSION CHART.
 *
 * 2026-09-28, Monday 11:33 ET: AVGO 5m rendered Friday's bars under a green LIVE badge.
 * `classifyIntradayTail` compared the tail against the last CLOSED session (Friday),
 * so a complete Friday tail answered 'fresh' all day on every intraday timeframe.
 *
 * This file is the property matrix for the fix: every intraday timeframe × Monday-
 * after-Friday, midweek, day-after-holiday, early close, premarket, RTH, after-hours,
 * weekend — plus the one invariant swept minute by minute across whole sessions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  classifyIntradayTail, isIntradayTailStale, isCurrentEnoughForPaint,
  intradayBarCurrentness, isCurrentnessSettled, CURRENTNESS, expectedLatestCompletedBar,
} from './marketSession'

const TFS = ['1', '5', '15', '30', '60']
// ET wall clock → unix seconds. EDT (UTC-4) for Sep dates, EST (UTC-5) for Jan/Nov.
const at = (iso, off = 4) => {
  const [d, t] = iso.split(' ')
  const [y, m, dd] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  return Math.floor(Date.UTC(y, m - 1, dd, h + off, mi) / 1000)
}
const setNow = (iso, off = 4) => vi.setSystemTime(at(iso, off) * 1000)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('AVGO — the exact production failure', () => {
  beforeEach(() => setNow('2026-09-28 11:33'))
  const FRI_1955 = at('2026-09-25 19:55')

  it('Friday 19:55 tail at Monday 11:33 is BEHIND, not fresh — and never gapped', () => {
    expect(classifyIntradayTail(FRI_1955, '5')).toBe('behind')
  })
  it('the expected completed 5m bar is the 11:25 bucket', () => {
    expect(expectedLatestCompletedBar('5')).toBe(at('2026-09-28 11:25'))
  })
  it('it is not current for paint, and the chart state is UPDATING, never settled', () => {
    expect(isCurrentEnoughForPaint(FRI_1955, '5')).toBe(false)
    const st = intradayBarCurrentness({ tf: '5', tailT: FRI_1955 })
    expect(st).toBe(CURRENTNESS.UPDATING)
    expect(isCurrentnessSettled(st)).toBe(false)
  })
  it('after the fast retries are spent it is DELAYED — still never current', () => {
    expect(intradayBarCurrentness({ tf: '5', tailT: FRI_1955, retriesExhausted: true }))
      .toBe(CURRENTNESS.DELAYED)
  })
  it('recovery: Monday bars through 11:25 make it CURRENT', () => {
    expect(intradayBarCurrentness({ tf: '5', tailT: at('2026-09-28 11:25') })).toBe(CURRENTNESS.CURRENT)
    expect(classifyIntradayTail(at('2026-09-28 11:25'), '5')).toBe('fresh')
  })
})

describe('the matrix — every intraday timeframe', () => {
  for (const tf of TFS) {
    describe(`tf=${tf}`, () => {
      it('Monday RTH after a Friday tail: behind, not settled', () => {
        setNow('2026-09-28 11:33')
        const t = at('2026-09-25 15:00')
        expect(classifyIntradayTail(t, tf)).toBe('behind')
        expect(isCurrentnessSettled(intradayBarCurrentness({ tf, tailT: t }))).toBe(false)
      })
      it('midweek RTH after yesterday\'s complete tail: behind, not settled', () => {
        setNow('2026-09-23 13:17')
        const t = at('2026-09-22 15:00')
        expect(classifyIntradayTail(t, tf)).toBe('behind')
        expect(isCurrentnessSettled(intradayBarCurrentness({ tf, tailT: t }))).toBe(false)
      })
      it('day after a holiday (MLK 2026-01-19): Friday tail is behind, never gapped', () => {
        setNow('2026-01-20 11:00', 5)
        const t = at('2026-01-16 15:00', 5)
        expect(classifyIntradayTail(t, tf)).toBe('behind')
        expect(isCurrentnessSettled(intradayBarCurrentness({ tf, tailT: t }))).toBe(false)
      })
      it('early close (2026-11-27): mid-session, the pre-holiday tail is behind', () => {
        setNow('2026-11-27 12:31', 5)
        const t = at('2026-11-25 15:00', 5)
        expect(classifyIntradayTail(t, tf)).toBe('behind')
        expect(isCurrentnessSettled(intradayBarCurrentness({ tf, tailT: t }))).toBe(false)
      })
      it('early close (2026-11-27): after 13:00 a tail at the final bucket is current', () => {
        setNow('2026-11-27 14:00', 5)
        const last = expectedLatestCompletedBar(tf)
        expect(new Date(last * 1000).getUTCHours()).toBeLessThan(18)   // the half day's final bucket, before 13:00 ET
        expect(isCurrentnessSettled(intradayBarCurrentness({ tf, tailT: last }))).toBe(true)
      })
      it('premarket (RTH view): a complete Friday tail is fresh with no expectation', () => {
        setNow('2026-09-28 08:00')
        const t = at('2026-09-25 15:55')
        expect(classifyIntradayTail(t, tf)).toBe('fresh')
        expect(intradayBarCurrentness({ tf, tailT: t })).toBe(CURRENTNESS.NO_EXPECTATION)
      })
      it('premarket (EXTENDED view): the same Friday tail is not current — 04:00-08:00 buckets are expected', () => {
        setNow('2026-09-28 08:00')
        const t = at('2026-09-25 19:55')
        expect(isCurrentnessSettled(intradayBarCurrentness({ tf, tailT: t, session: 'extended' }))).toBe(false)
      })
      it('active RTH: a tail at the frontier is current', () => {
        setNow('2026-09-28 11:33')
        expect(intradayBarCurrentness({ tf, tailT: expectedLatestCompletedBar(tf) })).toBe(CURRENTNESS.CURRENT)
      })
      it('after-hours: today\'s final RTH bucket is current; a Friday tail is gapped', () => {
        setNow('2026-09-28 17:00')
        const last = expectedLatestCompletedBar(tf)
        expect(classifyIntradayTail(last, tf)).toBe('fresh')
        expect(isCurrentnessSettled(intradayBarCurrentness({ tf, tailT: last }))).toBe(true)
        expect(classifyIntradayTail(at('2026-09-25 15:55'), tf)).toBe('gapped')
      })
      it('weekend: complete Friday is fresh/no-expectation; Thursday is gapped and not settled', () => {
        setNow('2026-09-27 12:00')
        expect(classifyIntradayTail(at('2026-09-25 15:55'), tf)).toBe('fresh')
        expect(intradayBarCurrentness({ tf, tailT: at('2026-09-25 15:55') })).toBe(CURRENTNESS.NO_EXPECTATION)
        expect(classifyIntradayTail(at('2026-09-24 15:55'), tf)).toBe('gapped')
        expect(isCurrentnessSettled(intradayBarCurrentness({ tf, tailT: at('2026-09-24 15:55') }))).toBe(false)
      })
    })
  }
})

describe('⛔ THE INVARIANT, swept minute by minute across whole sessions', () => {
  // For every minute of a regular session where today already has a completed bucket,
  // a prior-session tail (complete OR incomplete) must never classify fresh and never
  // settle. Swept on a Monday (weekend behind it), a midweek day, and a post-holiday Tuesday.
  const days = [
    { day: '2026-09-28', prior: '2026-09-25', off: 4 },
    { day: '2026-09-23', prior: '2026-09-22', off: 4 },
    { day: '2026-01-20', prior: '2026-01-16', off: 5 },
  ]
  for (const { day, prior, off } of days) {
    it(`${day}: no prior-session tail is ever fresh once a bucket of ${day} has completed`, () => {
      let checked = 0
      // Every minute of the first 90 (where the overnight-gap hole lived), then every 7.
      for (let m = 9 * 60 + 31; m < 16 * 60; m += (m < 11 * 60 ? 1 : 7)) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0')
        const mm = String(m % 60).padStart(2, '0')
        setNow(`${day} ${hh}:${mm}`, off)
        for (const tf of TFS) {
          if (expectedLatestCompletedBar(tf) == null) continue   // no completed bucket yet
          for (const tail of [at(`${prior} 15:55`, off), at(`${prior} 19:55`, off), at(`${prior} 12:00`, off)]) {
            const cls = classifyIntradayTail(tail, tf)
            if (cls === 'fresh') throw new Error(`${day} ${hh}:${mm} tf=${tf} prior tail classified fresh`)
            expect(isIntradayTailStale(tail, tf)).toBe(true)
            expect(isCurrentnessSettled(intradayBarCurrentness({ tf, tailT: tail }))).toBe(false)
            checked++
          }
        }
      }
      expect(checked).toBeGreaterThan(1500)
    }, 60_000)
  }

  it('1h 09:30 anchoring: no hourly bucket has completed at 09:45, one has at 10:05', () => {
    const fri = at('2026-09-25 15:00')
    setNow('2026-09-28 09:45')
    expect(classifyIntradayTail(fri, '60')).toBe('fresh')
    setNow('2026-09-28 10:05')
    expect(classifyIntradayTail(fri, '60')).toBe('behind')
  })
})

describe('observed tolerance vs server-verified absence', () => {
  beforeEach(() => setNow('2026-09-28 11:33'))

  it('ONE bucket behind is the product tolerance (current); TWO is not', () => {
    expect(intradayBarCurrentness({ tf: '5', tailT: at('2026-09-28 11:20') })).toBe(CURRENTNESS.CURRENT)
    expect(intradayBarCurrentness({ tf: '5', tailT: at('2026-09-28 11:15') })).toBe(CURRENTNESS.UPDATING)
  })
  it('beyond the tolerance, a provider check AFTER the 11:25 bucket closed proves currentness', () => {
    expect(intradayBarCurrentness({ tf: '5', tailT: at('2026-09-28 10:00'), verifiedThrough: at('2026-09-28 11:31') }))
      .toBe(CURRENTNESS.CURRENT)
  })
  it('CONTROL — a check BEFORE that bucket closed proves nothing ("illiquid" is not an answer)', () => {
    expect(intradayBarCurrentness({ tf: '5', tailT: at('2026-09-28 10:00'), verifiedThrough: at('2026-09-28 11:29') }))
      .toBe(CURRENTNESS.UPDATING)
  })
  it('CONTROL — verifiedThrough equal to the stored tail proves nothing', () => {
    const t = at('2026-09-28 10:00')
    expect(intradayBarCurrentness({ tf: '5', tailT: t, verifiedThrough: t })).toBe(CURRENTNESS.UPDATING)
  })
  it('1h: the 09:30 bucket is proven by a 10:01 check (it ends at 10:00, not 10:30)', () => {
    setNow('2026-09-28 10:20')
    expect(intradayBarCurrentness({ tf: '60', tailT: at('2026-09-25 15:00'), verifiedThrough: at('2026-09-28 10:01') }))
      .toBe(CURRENTNESS.CURRENT)
  })
  it('terminal no-data is UNAVAILABLE; no tail yet is UPDATING', () => {
    expect(intradayBarCurrentness({ tf: '5', tailT: null, terminalNoData: true })).toBe(CURRENTNESS.UNAVAILABLE)
    expect(intradayBarCurrentness({ tf: '5', tailT: null })).toBe(CURRENTNESS.UPDATING)
  })
})
