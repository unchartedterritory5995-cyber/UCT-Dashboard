// The shared ET-date formatter and the deep-history close cache (2026-11-19, from a live
// profile of a 1h ticker switch).
//   E1 etDateLabel is exactly toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
//      at every hour across both 2026 DST transitions and around midnight ET
//   E2 the D bucket label is unchanged
//   E3 the close cache holds a deep chart's days: a second pass over 6,000 ET days asks the
//      calendar nothing (the old 4,000-day cap cleared itself and asked again for every day)
import { describe, it, expect, vi } from 'vitest'
import * as nyse from '../../lib/marketClock/nyseCalendar.js'

vi.mock('../../lib/marketClock/nyseCalendar.js', async (importOriginal) => {
  const m = await importOriginal()
  return { ...m, earlyCloseOn: vi.fn(m.earlyCloseOn) }
})
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

  it('E3 a second pass over 6,000 ET days is served from the cache, half-days intact', () => {
    const day0 = Math.floor(Date.UTC(2005, 0, 3) / 86400000)
    const at = (d) => d * 86400 + 600 * 60                    // 10:00 chart time on ET day d
    for (let d = day0; d < day0 + 6000; d++) rthCloseMinuteOfChartTime(at(d))
    nyse.earlyCloseOn.mockClear()
    for (let d = day0; d < day0 + 6000; d++) rthCloseMinuteOfChartTime(at(d))
    expect(nyse.earlyCloseOn).not.toHaveBeenCalled()
    const blackFriday2025 = Math.floor(Date.UTC(2025, 10, 28) / 86400000)
    expect(rthCloseMinuteOfChartTime(at(blackFriday2025))).toBe(13 * 60)
    expect(rthCloseMinuteOfChartTime(at(blackFriday2025 + 3))).toBe(16 * 60)
  })
})
