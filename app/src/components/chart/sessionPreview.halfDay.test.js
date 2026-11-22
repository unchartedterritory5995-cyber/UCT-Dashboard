import { describe, it, expect } from 'vitest'
import { aggregateExtBars } from './sessionPreview'
import { rthCloseMinuteOf, isRthBar, toChartTime } from './barTime'
import { holidayOn, earlyCloseOn } from '../../lib/marketClock/nyseCalendar'

// ⛔ NYSE HALF-DAY POST WINDOW. The post-market preview aggregated a FIXED 16:00-20:00, so on
// a half-day (13:00 close) it ignored the 13:00-16:00 post-market bars while the legend lock
// (isRthBar) froze from 13:00. The post window is the day's close → close + 4h.
// All prices synthetic.

const etUnix = (y, mo, d, h, m) => {
  const wall = Date.UTC(y, mo - 1, d, h, m) / 1000
  return toChartTime(wall + 18000) === wall ? wall + 18000 : wall + 14400
}
const day5m = (y, mo, d) => {
  const out = []
  for (let mins = 4 * 60; mins < 20 * 60; mins += 5) {
    const t = etUnix(y, mo, d, Math.floor(mins / 60), mins % 60)
    out.push({ t, o: 10 + mins / 1000, h: 10.5 + mins / 1000, l: 9.5 + mins / 1000, c: 10.1 + mins / 1000, v: 1 })
  }
  return out
}
const isoOf = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`

describe('post-market preview window = the day\'s close → close + 4h', () => {
  it('half-day 2026-11-27: aggregates 13:00-16:55 (48 bars), opens on the 13:00 bar', () => {
    const bars = day5m(2026, 11, 27)
    const a = aggregateExtBars(bars, { session: 'post', todayEt: isoOf(2026, 11, 27) })
    const inWin = bars.filter(b => { const m = (((toChartTime(b.t) % 86400) + 86400) % 86400) / 60; return m >= 780 && m < 1020 })
    expect(inWin.length).toBe(48)
    expect(a.volume).toBe(48)
    expect(a.open).toBe(inWin[0].o)
    expect(a.close).toBe(inWin[inWin.length - 1].c)
    // …and the window starts exactly where the regular session ends.
    expect(isRthBar(inWin[0].t)).toBe(false)
    expect(isRthBar(inWin[0].t - 300)).toBe(true)
  })
  it('ordinary day 2026-11-25: still 16:00-19:55 (48 bars), 13:30 is not post', () => {
    const bars = day5m(2026, 11, 25)
    const a = aggregateExtBars(bars, { session: 'post', todayEt: isoOf(2026, 11, 25) })
    expect(a.volume).toBe(48)
    expect(a.open).toBe(bars.find(b => b.t === etUnix(2026, 11, 25, 16, 0)).o)
  })
})

describe('NYSE calendar coverage: the 2027 half-day resolves to a 13:00 close', () => {
  // 2027-12-24 is NOT a half-day: Christmas falls on a Saturday, so NYSE observes it on
  // Friday Dec 24 — a full holiday (no session at all). The calendar must say so.
  it('2027-12-24 is the observed Christmas holiday, not an early close', () => {
    expect(holidayOn('2027-12-24')).toBeTruthy()
    expect(earlyCloseOn('2027-12-24')).toBe(null)
  })
  for (const [mo, d] of [[11, 26]]) {
    it(`2027-${mo}-${d} → 780`, () => {
      expect(rthCloseMinuteOf(etUnix(2027, mo, d, 10, 0))).toBe(780)
      expect(isRthBar(etUnix(2027, mo, d, 13, 0))).toBe(false)
      expect(isRthBar(etUnix(2027, mo, d, 12, 55))).toBe(true)
    })
  }
  it('an ordinary 2027 day keeps 16:00', () => {
    expect(rthCloseMinuteOf(etUnix(2027, 11, 24, 10, 0))).toBe(960)
  })
})
