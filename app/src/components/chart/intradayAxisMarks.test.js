// A zoomed-out intraday axis (1h over months) names its year and month marks as a daily chart does — "2026", "Feb" —
// not by the first session under them ("Jan 2", "Feb 2"). Day and time marks are unchanged. (owner's 1h axis, 2026-11-20)
import { describe, it, expect, vi } from 'vitest'
import { chartTickMarkFormatter, chartTickMarkFormatter24, studyTickMarkFormatter, timeAxisFormattersFor } from '../StockChart'

// chart time: ET wall clock read as UTC (barTime.toChartTime)
const ct = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) / 1000

describe('intraday axis: year and month marks', () => {
  it('year mark → the year, month mark → the month', () => {
    expect(chartTickMarkFormatter(ct(2026, 1, 2, 9, 30), 0)).toBe('2026')
    expect(chartTickMarkFormatter(ct(2026, 2, 2, 9, 30), 1)).toBe('Feb')
    expect(chartTickMarkFormatter24(ct(2026, 3, 2, 9, 30), 1)).toBe('Mar')
    expect(studyTickMarkFormatter(ct(2026, 3, 2, 9, 30), 1)).toBe('Mar')
  })
  it('day and time marks unchanged', () => {
    expect(chartTickMarkFormatter(ct(2026, 2, 3, 9, 30), 2)).toBe('Feb 3')
    expect(chartTickMarkFormatter(ct(2026, 2, 3, 12, 30), 3)).toBe('12:30 PM')
    expect(chartTickMarkFormatter24(ct(2026, 2, 3, 12, 30), 3)).toBe('12:30')
  })
  it('another time zone reads the mark in that zone', () => {
    // 09:30 ET on Jan 2 is 14:30 in London, still Jan 2026
    const f = timeAxisFormattersFor(false, 'Europe/London', false)
    expect(f.tick(ct(2026, 1, 2, 9, 30), 0)).toBe('2026')
    expect(f.tick(ct(2026, 2, 2, 9, 30), 1)).toBe('Feb')
  })
  it('a zone far west of New York names the mark on the exchange clock', () => {
    // 04:00 ET on Apr 1 (the month's pre-market first bar) is Mar 31 in Honolulu: the mark still reads Apr
    // (Local (browser) in Honolulu: the only way a zone that far west reaches the axis)
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Pacific/Honolulu' })
    try {
      const f = timeAxisFormattersFor(false, 'local', false)
      expect(f.tick(ct(2026, 4, 1, 4, 0), 1)).toBe('Apr')
      expect(f.tick(ct(2026, 1, 2, 4, 0), 0)).toBe('2026')
      expect(f.tick(ct(2026, 4, 1, 4, 0), 2)).toBe('Mar 31')   // a day mark still reads in the zone
    } finally { spy.mockRestore() }
  })
  it('daily marks unchanged', () => {
    expect(chartTickMarkFormatter('2026-01-02', 0)).toBe('2026')
    expect(chartTickMarkFormatter('2026-02-02', 1)).toBe('Feb')
    expect(chartTickMarkFormatter('2026-02-03', 2)).toBe('3')
  })
})
