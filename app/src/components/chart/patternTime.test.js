// The anchor-time conversion PatternOverlay runs before timeToCoordinate.
//
// ⛔ THE BUG IT FIXES: the engine's daily anchors are YYYYMMDD ints (bars_sqlite stores daily
// `ts` that way) while the candle series is keyed 'YYYY-MM-DD'; intraday anchors are UTC epoch
// seconds while the series is ET-shifted. Unconverted, timeToCoordinate answered null for every
// anchor and every shape silently drew nothing. The first case below is that exact input.
import { describe, it, expect } from 'vitest'
import { toChartTime, snapToBar, anchorToBarTime, isDateTf } from './patternTime'

// A fixed offset keeps the intraday cases independent of the box's timezone/DST.
const ET = -4 * 3600

describe('toChartTime', () => {
  it('D: a YYYYMMDD int becomes the series ISO date (the production daily anchor)', () => {
    expect(toChartTime(20261015, 'D', ET)).toBe('2026-10-15')
  })

  it('W / M use the same ISO calendar date (the snap picks the bar)', () => {
    expect(toChartTime(20261014, 'W', ET)).toBe('2026-10-14')
    expect(toChartTime(20261014, 'M', ET)).toBe('2026-10-14')
  })

  it('D: UTC epoch seconds become the ET calendar date, not the UTC one', () => {
    // 2026-10-16 02:00 UTC is still 2026-10-15 in New York.
    const sec = Date.UTC(2026, 9, 16, 2, 0) / 1000
    expect(toChartTime(sec, 'D', ET)).toBe('2026-10-15')
  })

  it('D: an ISO string passes through', () => {
    expect(toChartTime('2026-10-15', 'D', ET)).toBe('2026-10-15')
  })

  it('intraday: UTC epoch seconds get the same ET shift StockChart.adjustTime applies', () => {
    const sec = Date.UTC(2026, 9, 15, 14, 30) / 1000 // 10:30 EDT
    expect(toChartTime(sec, '5', ET)).toBe(sec + ET)
    expect(toChartTime(sec, '60', ET)).toBe(sec + ET)
  })

  it('intraday: a daily date lands on that session\'s 09:30 ET open (DST-correct)', () => {
    const edt = Date.UTC(2026, 9, 15, 13, 30) / 1000   // Oct: EDT, 09:30 = 13:30 UTC
    const est = Date.UTC(2026, 0, 15, 14, 30) / 1000   // Jan: EST, 09:30 = 14:30 UTC
    expect(toChartTime(20261015, '5', ET)).toBe(edt + ET)
    expect(toChartTime(20260115, '5', ET)).toBe(est + ET)
  })

  it('refuses what it cannot read — null, never a guess', () => {
    expect(toChartTime(null, 'D', ET)).toBeNull()
    expect(toChartTime('', 'D', ET)).toBeNull()
    expect(toChartTime('not a date', 'D', ET)).toBeNull()
    expect(toChartTime(-5, '5', ET)).toBeNull()
  })

  it('isDateTf', () => {
    expect(['D', 'W', 'M'].every(isDateTf)).toBe(true)
    expect(['1', '5', '15', '30', '60'].some(isDateTf)).toBe(false)
  })
})

describe('snapToBar', () => {
  const daily = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']
  const weekly = ['2026-10-02', '2026-10-09', '2026-10-16'] // dated by the Friday close
  const monthly = ['2026-08-01', '2026-09-01', '2026-10-01'] // dated by the 1st

  it('D: an exact date is itself; a weekend date floors to the Friday before', () => {
    expect(snapToBar('2026-10-14', daily, 'D')).toBe('2026-10-14')
    expect(snapToBar('2026-10-11', ['2026-10-09', '2026-10-12'], 'D')).toBe('2026-10-09')
  })

  it('W: a mid-week date belongs to THAT week\'s Friday bar (ceil, not floor)', () => {
    expect(snapToBar('2026-10-14', weekly, 'W')).toBe('2026-10-16')
    expect(snapToBar('2026-10-09', weekly, 'W')).toBe('2026-10-09')
  })

  it('M: a date belongs to its month\'s bar dated the 1st (floor)', () => {
    expect(snapToBar('2026-09-17', monthly, 'M')).toBe('2026-09-01')
  })

  it('intraday: a time floors to its bucket start', () => {
    expect(snapToBar(1030, [900, 1200, 1500], '5')).toBe(900)
  })

  it('outside the loaded bars is null (skip the shape, never clamp to an edge)', () => {
    expect(snapToBar('2026-01-01', daily, 'D')).toBeNull()
    expect(snapToBar('2026-12-01', weekly, 'W')).toBeNull()
  })
})

describe('anchorToBarTime', () => {
  it('converts then snaps: a YYYYMMDD anchor on a weekly chart lands on its Friday bar', () => {
    expect(anchorToBarTime(20261013, 'W', ['2026-10-09', '2026-10-16'], ET)).toBe('2026-10-16')
  })

  it('with no bar list it returns the converted time', () => {
    expect(anchorToBarTime(20261015, 'D', null, ET)).toBe('2026-10-15')
  })
})
