// app/src/components/dashboard/sessionModel.test.js
//
// `sessionModel()` itself is unchanged (pure label/tone mapping). The
// regression this pins is `nextOpenHint()`'s upgrade from a fixed "next
// weekday" guess to S11's real calendar: it must skip a holiday, never
// name a market-closed Monday as the next open.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { sessionModel, nextOpenHint } from './sessionModel'

afterEach(() => {
  vi.useRealTimers()
})

describe('sessionModel', () => {
  it('maps each boolean combination to a distinct label/tone', () => {
    expect(sessionModel({ isOpen: true, isPremarket: false, isExtended: false })).toEqual({ label: 'MARKET OPEN', tone: 'open' })
    expect(sessionModel({ isOpen: false, isPremarket: true, isExtended: false })).toEqual({ label: 'PRE-MARKET', tone: 'ext' })
    expect(sessionModel({ isOpen: false, isPremarket: false, isExtended: true })).toEqual({ label: 'AFTER-HOURS', tone: 'ext' })
    expect(sessionModel({ isOpen: false, isPremarket: false, isExtended: false })).toEqual({ label: 'MARKET CLOSED', tone: 'closed' })
  })
})

describe('nextOpenHint — calendar-aware (the S11 upgrade)', () => {
  it('same-day hint while pre-market, before the open', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T14:00:00Z')) // 9:00am ET, pre-market
    expect(nextOpenHint()).toBe('Opens 9:30 AM ET')
  })

  it('skips a Monday holiday and names the following trading day', () => {
    // Friday 2026-01-16 after the close; Monday 2026-01-19 is MLK Day
    // (a full NYSE holiday) — the OLD naive logic would have said
    // "Opens Mon 9:30 AM ET" (wrong: Monday is closed). The real next open
    // is Tuesday 2026-01-20.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-16T22:00:00Z')) // Fri 5:00pm ET, after close
    expect(nextOpenHint()).toBe('Opens Tue 9:30 AM ET')
  })
})
