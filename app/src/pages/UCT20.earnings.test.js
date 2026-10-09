// U20: the earnings badge counts days on the ET calendar (lane C audit 2026-10-08). It counted
// from the browser's own "today", so outside US time zones "ER TODAY" showed a day early or late.
import { describe, expect, it } from 'vitest'
import { earningsInfo } from './UCT20'

// 03:00 UTC on Oct 8 is 11:00 PM ET on Oct 7: the UTC date and the ET date differ.
const LATE_EVENING_ET = Date.parse('2026-10-08T03:00:00Z')

describe('earningsInfo', () => {
  it('a report dated the ET today reads ER TODAY, even when UTC has already rolled over', () => {
    const e = earningsInfo({ earnings_date: '2026-10-07', earnings_session: 'AMC' }, LATE_EVENING_ET)
    expect(e.days).toBe(0)
    expect(e.badge).toBe('ER TODAY · AMC')
    expect(e.soon).toBe(true)
  })

  it('just after ET midnight the new ET day is already TODAY (machines west of ET still say yesterday)', () => {
    // 04:30 UTC on Oct 8 is 12:30 AM ET Oct 8, but still Oct 7 in Chicago and Los Angeles.
    const e = earningsInfo({ earnings_date: '2026-10-08' }, Date.parse('2026-10-08T04:30:00Z'))
    expect(e.days).toBe(0)
  })

  it('the next ET day is 1D, and a report already past is no badge', () => {
    expect(earningsInfo({ earnings_date: '2026-10-08' }, LATE_EVENING_ET).badge).toBe('ER 1D')
    expect(earningsInfo({ earnings_date: '2026-10-06' }, LATE_EVENING_ET)).toBeNull()
  })

  it('without a date it falls back to the shipped days_to_earnings', () => {
    expect(earningsInfo({ days_to_earnings: 3 }, LATE_EVENING_ET).badge).toBe('ER 3D')
  })
})
