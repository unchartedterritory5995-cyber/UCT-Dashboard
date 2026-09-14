// app/src/pages/breadth/sessionDates.test.js
import { describe, it, expect } from 'vitest'
import { todayET, shiftISO, shortSessionDate } from './sessionDates'

describe('todayET', () => {
  // A-35: the window used the UTC date, so from 8 PM ET "today" was tomorrow.
  it('is the Eastern date in the evening, not the UTC one', () => {
    expect(todayET(new Date('2026-09-14T03:30:00Z'))).toBe('2026-09-13')
  })
  it('turns over at Eastern midnight in winter', () => {
    expect(todayET(new Date('2026-01-15T04:59:00Z'))).toBe('2026-01-14')
    expect(todayET(new Date('2026-01-15T05:00:00Z'))).toBe('2026-01-15')
  })
})

describe('shiftISO', () => {
  it('crosses month, year and leap-year boundaries', () => {
    expect(shiftISO('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftISO('2024-03-01', -1)).toBe('2024-02-29')
    expect(shiftISO('2026-06-15', -90)).toBe('2026-03-17')
    expect(shiftISO('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('shortSessionDate', () => {
  it('omits the year only when it matches the reference', () => {
    expect(shortSessionDate('2026-08-07', '2026-09-11')).toBe('Aug 7')
    expect(shortSessionDate('2025-12-31', '2026-01-02')).toBe('Dec 31, 2025')
    expect(shortSessionDate('2026-08-07')).toBe('Aug 7, 2026')
  })
})
