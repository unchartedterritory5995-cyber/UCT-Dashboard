import { describe, it, expect, vi, afterEach } from 'vitest'
import { etMinutesOfUnix } from './marketSession'

// The slow form this replaces: one Intl-backed format per bar.
const viaIntl = (unixSec) => {
  const s = new Date(unixSec * 1000).toLocaleString('en-US', {
    timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit',
  })
  const [h, m] = s.split(':').map(Number)
  return (h % 24) * 60 + m
}

afterEach(() => { vi.restoreAllMocks() })

describe('etMinutesOfUnix', () => {
  it('agrees with the Intl answer across a year, hour by hour', () => {
    const start = Date.UTC(2026, 0, 1) / 1000
    for (let t = start; t < start + 366 * 86400; t += 3600 + 37) {
      expect(etMinutesOfUnix(t)).toBe(viaIntl(t))
    }
  })

  it('agrees on both DST transition days, minute by minute around the change', () => {
    // 2026-03-08 and 2026-11-01: the 2am ET jumps.
    for (const day of [Date.UTC(2026, 2, 8) / 1000, Date.UTC(2026, 10, 1) / 1000]) {
      for (let t = day; t < day + 86400; t += 60) {
        expect(etMinutesOfUnix(t)).toBe(viaIntl(t))
      }
    }
  })

  it('agrees for old and fractional timestamps', () => {
    expect(etMinutesOfUnix(1000000000.5)).toBe(viaIntl(1000000000))
    const t = Date.UTC(2005, 3, 3, 12) / 1000
    expect(etMinutesOfUnix(t)).toBe(viaIntl(t))
  })

  it('a chart-sized series costs a handful of timezone lookups, not one per bar', () => {
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
    const start = Date.UTC(2020, 5, 1, 14) / 1000
    for (let i = 0; i < 3000; i++) etMinutesOfUnix(start + i * 1800)
    expect(spy.mock.calls.length).toBeLessThan(200)
  })
})
