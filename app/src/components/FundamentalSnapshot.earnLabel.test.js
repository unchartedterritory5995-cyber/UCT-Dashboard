import { describe, it, expect } from 'vitest'
import { earnLabel } from './FundamentalSnapshot'

// DES earnings chip -- the day count is between ET calendar dates.
describe('earnLabel', () => {
  it('an earnings date that is today in ET reads "today", even after 8 PM ET (past UTC midnight)', () => {
    // 2026-10-05 21:00 ET = 2026-10-06T01:00Z. UTC math said "in -1d" -> plain date.
    expect(earnLabel('2026-10-05', Date.parse('2026-10-06T01:00:00Z'))).toBe('Oct 5 · today')
    // And tomorrow-in-ET is "in 1d", not "today".
    expect(earnLabel('2026-10-06', Date.parse('2026-10-06T01:00:00Z'))).toBe('Oct 6 · in 1d')
  })

  it('a date within 45 days counts forward; past or far dates are the bare date', () => {
    expect(earnLabel('2026-10-17', Date.parse('2026-10-05T15:00:00Z'))).toBe('Oct 17 · in 12d')
    expect(earnLabel('2026-09-30', Date.parse('2026-10-05T15:00:00Z'))).toBe('Sep 30')
    expect(earnLabel('2027-03-01', Date.parse('2026-10-05T15:00:00Z'))).toBe('Mar 1')
    expect(earnLabel('garbage')).toBeNull()
  })
})
