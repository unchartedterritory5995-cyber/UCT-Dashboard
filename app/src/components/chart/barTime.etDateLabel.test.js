// The shared ET-date formatter and the deep-history close cache (2026-11-19, from a live
// profile of a 1h ticker switch).
//   E1 etDateLabel is exactly toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
//      at every hour across both 2026 DST transitions and around midnight ET
//   E2 the D bucket label is unchanged
//   E3 the half-day close survives a walk over more ET days than the old 4,000-day cache held
import { describe, it, expect } from 'vitest'
import { etDateLabel, computeBarTime, rthCloseMinuteOfChartTime } from './barTime'

const slow = (sec) => new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

describe('etDateLabel', () => {
  it('E1 matches toLocaleDateString hour by hour through 2026 (both DST changes)', () => {
    const start = Date.UTC(2026, 0, 1) / 1000
    for (let s = start; s < start + 366 * 86400; s += 3600) expect(etDateLabel(s)).toBe(slow(s))
    // the minutes either side of ET midnight
    const nov19 = Date.UTC(2026, 10, 20, 5, 0, 0) / 1000   // 00:00 EST on 11-20
    for (const d of [-61, -1, 0, 1, 59]) expect(etDateLabel(nov19 + d)).toBe(slow(nov19 + d))
  })

  it('E2 the daily bucket label is the ET date', () => {
    const t = Date.UTC(2026, 6, 4, 3, 30) / 1000             // 23:30 ET on 07-03
    expect(computeBarTime('D', t)).toBe('2026-07-03')
    expect(computeBarTime('D', t)).toBe(slow(t))
  })

  it('E3 a 6,000-day walk keeps the half-day close right on both passes', () => {
    const day0 = Math.floor(Date.UTC(2005, 0, 3) / 86400000)
    const blackFriday2025 = Math.floor(Date.UTC(2025, 10, 28) / 86400000)
    for (let pass = 0; pass < 2; pass++) {
      for (let d = day0; d < day0 + 8000; d++) rthCloseMinuteOfChartTime(d * 86400 + 600 * 60)
      expect(rthCloseMinuteOfChartTime(blackFriday2025 * 86400 + 600 * 60)).toBe(13 * 60)
      expect(rthCloseMinuteOfChartTime((blackFriday2025 + 3) * 86400 + 600 * 60)).toBe(16 * 60)
    }
  })
})
