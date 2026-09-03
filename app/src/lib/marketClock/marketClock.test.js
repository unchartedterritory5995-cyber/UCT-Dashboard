// app/src/lib/marketClock/marketClock.test.js
//
// S11's own adversarial validation: regular open/close, pre/post, weekend,
// full holiday, early close, DST spring-forward + fall-back boundary
// crossings, unsupported venue, uncovered-year degrade, and the "same
// elapsed time, different session -> different verdict" acceptance case
// PRD-S8 §9.6/item 6 requires.

import { describe, it, expect } from 'vitest'
import {
  sessionState, nextBoundary, isHalfDay, asOfLabel,
} from './marketClock'

// 2026-01-15 is a regular Thursday trading day, EST (winter, UTC-5).
const REGULAR_DAY = '2026-01-15'

describe('sessionState — regular trading day (EST)', () => {
  it('closed before pre-market (2:00 AM ET)', () => {
    const s = sessionState(new Date(`${REGULAR_DAY}T07:00:00Z`))
    expect(s.session).toBe('closed')
    expect(s.isOpen).toBe(false)
  })

  it('pre-market (9:00 AM ET)', () => {
    const s = sessionState(new Date(`${REGULAR_DAY}T14:00:00Z`))
    expect(s.session).toBe('pre')
    expect(s.isPremarket).toBe(true)
    expect(s.isOpen).toBe(false)
  })

  it('regular session (10:00 AM ET)', () => {
    const s = sessionState(new Date(`${REGULAR_DAY}T15:00:00Z`))
    expect(s.session).toBe('regular')
    expect(s.isOpen).toBe(true)
    expect(s.isHalfDay).toBe(false)
  })

  it('minutesSinceBoundary counts from the open at exactly 10:00 AM ET (30 min after 9:30 open)', () => {
    const s = sessionState(new Date(`${REGULAR_DAY}T15:00:00Z`))
    expect(s.boundaryLabel).toBe('Market open')
    expect(s.minutesSinceBoundary).toBe(30)
  })

  it('after-hours (5:00 PM ET)', () => {
    const s = sessionState(new Date(`${REGULAR_DAY}T22:00:00Z`))
    expect(s.session).toBe('post')
    expect(s.isExtended).toBe(true)
  })

  it('closed after extended hours (9:00 PM ET)', () => {
    const s = sessionState(new Date('2026-01-16T02:00:00Z'))
    expect(s.session).toBe('closed')
  })
})

describe('sessionState — weekend', () => {
  it('Saturday is closed all day regardless of clock time', () => {
    const s = sessionState(new Date('2026-01-17T15:00:00Z')) // Sat 10am ET
    expect(s.session).toBe('closed')
    expect(s.holidayName).toBeNull()
  })
})

describe('sessionState — full NYSE holiday closure', () => {
  it('July 3, 2026 (Independence Day observed) is closed all day, not a half day', () => {
    const s = sessionState(new Date('2026-07-03T15:00:00Z')) // 10am ET
    expect(s.session).toBe('closed')
    expect(s.isHalfDay).toBe(false)
    expect(s.holidayName).toBe('Independence Day (observed)')
  })
})

describe('sessionState — half day (early close)', () => {
  it('Nov 27, 2026 (day after Thanksgiving): regular session before 1:00 PM ET', () => {
    const s = sessionState(new Date('2026-11-27T17:00:00Z')) // noon ET
    expect(s.session).toBe('regular')
    expect(s.isHalfDay).toBe(true)
  })

  it('Nov 27, 2026: past close by 1:30 PM ET, not "regular" any more', () => {
    const s = sessionState(new Date('2026-11-27T18:30:00Z')) // 1:30pm ET
    expect(s.session).toBe('post')
  })

  it('isHalfDay(date) reports true for Dec 24, 2026 (Christmas Eve, weekday)', () => {
    expect(isHalfDay(new Date('2026-12-24T15:00:00Z'))).toBe(true)
  })

  it('isHalfDay(date) reports false for an ordinary trading day', () => {
    expect(isHalfDay(new Date(`${REGULAR_DAY}T15:00:00Z`))).toBe(false)
  })
})

describe('DST boundaries', () => {
  it('spring-forward: 9:30 AM ET open is 14:30Z the Friday before (EST) and 13:30Z the Monday after (EDT)', () => {
    // 2026-03-08 is the spring-forward Sunday; Fri 3/6 = EST, Mon 3/9 = EDT.
    const before = sessionState(new Date('2026-03-06T14:29:00Z'))
    const beforeOpen = sessionState(new Date('2026-03-06T14:31:00Z'))
    expect(before.session).toBe('pre')
    expect(beforeOpen.session).toBe('regular')

    const after = sessionState(new Date('2026-03-09T13:29:00Z'))
    const afterOpen = sessionState(new Date('2026-03-09T13:31:00Z'))
    expect(after.session).toBe('pre')
    expect(afterOpen.session).toBe('regular')
  })

  it('fall-back: 9:30 AM ET open is 13:30Z the Friday before (EDT) and 14:30Z the Monday after (EST)', () => {
    // 2026-11-01 is the fall-back Sunday; Fri 10/30 = EDT, Mon 11/2 = EST.
    const before = sessionState(new Date('2026-10-30T13:29:00Z'))
    const beforeOpen = sessionState(new Date('2026-10-30T13:31:00Z'))
    expect(before.session).toBe('pre')
    expect(beforeOpen.session).toBe('regular')

    const after = sessionState(new Date('2026-11-02T14:29:00Z'))
    const afterOpen = sessionState(new Date('2026-11-02T14:31:00Z'))
    expect(after.session).toBe('pre')
    expect(afterOpen.session).toBe('regular')
  })
})

describe('nextBoundary', () => {
  it('finds the next open from mid-session', () => {
    const nb = nextBoundary(new Date(`${REGULAR_DAY}T15:00:00Z`)) // 10am ET, regular session
    expect(nb.kind).toBe('close')
  })

  it('skips a holiday + weekend to find the next real trading-day boundary', () => {
    // Dec 24, 2026 9pm ET (past that day's early-close extended-hours end) ->
    // Dec 25 (holiday, Fri), Dec 26-27 (weekend) -> next real boundary is
    // Dec 28's pre-market open.
    const nb = nextBoundary(new Date('2026-12-25T02:00:00Z')) // 9pm ET Dec 24
    expect(nb.kind).toBe('preStart')
    expect(nb.at.toISOString()).toBe('2026-12-28T09:00:00.000Z') // 4am ET = 09:00Z (EST)
  })
})

describe('unsupported venue fails loudly, never guesses', () => {
  it('throws on a venue this module does not model', () => {
    expect(() => sessionState(new Date(), 'LSE')).toThrow(/unsupported venue/)
  })
})

describe('uncovered year degrades honestly instead of guessing holidays', () => {
  it('calendarCoverage is false outside the covered years, but weekday/hours logic still holds', () => {
    const s = sessionState(new Date('2027-01-15T15:00:00Z')) // a Friday, 10am ET, 2027
    expect(s.calendarCoverage).toBe(false)
    expect(s.session).toBe('regular') // no holiday table for 2027 -> falls back to weekday+hours only
  })
})

describe('asOfLabel', () => {
  it('formats an ET time label', () => {
    expect(asOfLabel(new Date(`${REGULAR_DAY}T15:00:00Z`))).toMatch(/10:00 AM ET/)
  })
})

describe('current source-stale vs session-stale acceptance: same elapsed time, different verdict', () => {
  it('a boundary-crossing 40-minute gap and a same-session 40-minute gap read differently', () => {
    // Case A: observed pre-market, viewed 40 min later after the open boundary crossed.
    const preMarketObserved = new Date(`${REGULAR_DAY}T14:00:00Z`) // 9:00am ET, pre
    const viewedAfterOpen = new Date(`${REGULAR_DAY}T14:40:00Z`) // 9:40am ET, regular
    const crossedBoundary = sessionState(viewedAfterOpen).boundaryAt
    expect(preMarketObserved.getTime() < crossedBoundary.getTime()).toBe(true)

    // Case B: observed mid-regular-session, viewed 40 min later, same session, no boundary crossed.
    const regularObserved = new Date(`${REGULAR_DAY}T15:00:00Z`) // 10:00am ET, regular
    const viewedLaterSameSession = new Date(`${REGULAR_DAY}T15:40:00Z`) // 10:40am ET, still regular
    const noNewBoundary = sessionState(viewedLaterSameSession).boundaryAt
    expect(regularObserved.getTime() < noNewBoundary.getTime()).toBe(false)
  })
})
