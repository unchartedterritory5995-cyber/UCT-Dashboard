import { describe, it, expect } from 'vitest'
import { parseEtTimestamp, etYmd, etCalendarDaysBetween, etWallToEpochMs, etOffsetMs } from './etTime'

describe('etTime', () => {
  it('parses a zone-less wall clock as ET, DST-correct', () => {
    expect(parseEtTimestamp('2026-08-09 18:00:00')).toBe(Date.parse('2026-08-09T22:00:00Z')) // EDT
    expect(parseEtTimestamp('2026-01-15 09:30:00')).toBe(Date.parse('2026-01-15T14:30:00Z')) // EST
    expect(parseEtTimestamp('2026-03-15')).toBe(Date.parse('2026-03-15T04:00:00Z'))          // after spring-forward
  })

  it('honours a string that carries its own zone', () => {
    expect(parseEtTimestamp('2026-08-09T18:00:00Z')).toBe(Date.parse('2026-08-09T18:00:00Z'))
    expect(parseEtTimestamp('2026-08-09 18:00:00+00:00')).toBe(Date.parse('2026-08-09T18:00:00Z'))
  })

  it('rejects junk and impossible dates', () => {
    expect(parseEtTimestamp('not a date')).toBeNaN()
    expect(parseEtTimestamp('2026-02-31 10:00:00')).toBeNaN()
    expect(parseEtTimestamp(null)).toBeNaN()
  })

  it('round-trips across both DST transitions', () => {
    // 2026-03-08 spring forward, 2026-11-01 fall back
    expect(etWallToEpochMs(2026, 3, 8, 12, 0, 0)).toBe(Date.parse('2026-03-08T16:00:00Z'))
    expect(etWallToEpochMs(2026, 11, 1, 12, 0, 0)).toBe(Date.parse('2026-11-01T17:00:00Z'))
    expect(etOffsetMs(Date.parse('2026-07-01T12:00:00Z'))).toBe(-4 * 3600e3)
    expect(etOffsetMs(Date.parse('2026-12-01T12:00:00Z'))).toBe(-5 * 3600e3)
  })

  it('ET calendar date and day differences ignore the UTC rollover', () => {
    // 22:30 ET on Oct 5 is 02:30Z on Oct 6 -- still Oct 5 in ET.
    const lateEvening = Date.parse('2026-10-06T02:30:00Z')
    expect(etYmd(lateEvening)).toBe('2026-10-05')
    expect(etCalendarDaysBetween('2026-10-02', lateEvening)).toBe(3)
    expect(etCalendarDaysBetween(lateEvening, '2026-10-08')).toBe(3)
    expect(etCalendarDaysBetween('2026-10-05', 'nope')).toBeNaN()
  })
})
