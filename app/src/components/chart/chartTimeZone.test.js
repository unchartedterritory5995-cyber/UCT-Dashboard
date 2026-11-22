// Chart Settings → Canvas → Scale & time → Time zone (owner 11-16): the intraday axis + crosshair labels re-read in
// another zone, DST-correct per instant in BOTH zones. Chart time = ET wall clock written as UTC seconds.
import { describe, it, expect } from 'vitest'
import { chartTimeInZone, ianaZoneFor, browserTimeZone, wallSecIn } from './chartTimeZone'
import { toChartTime } from './barTime'
import { TIME_ZONES, timeZoneOf, sanitizeScaleTime, scaleTimePatch, extendedHoursOf } from './chartViewOptions'
import { mergeChartSettings } from './chartDefaults'
import { resolveShowExtended } from '../../utils/viewSession'
import {
  timeAxisFormattersFor, chartTickMarkFormatter, chartTickMarkFormatter24, chartCrosshairTimeFormatter,
  chartCrosshairTimeFormatter24, studyTickMarkFormatter, studyTickMarkFormatter24,
} from '../StockChart'

// ET wall clock y-m-d h:m as chart time (no real market data — synthetic instants only).
const et = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi) / 1000
const wall = (sec) => new Date(sec * 1000).toISOString().slice(0, 16).replace('T', ' ')

describe('chartTimeInZone — ET wall → instant → zone wall, DST-correct in both zones', () => {
  // 2026: US springs forward Mar 8 and falls back Nov 1; the UK springs forward Mar 29 and falls back Oct 25.
  // So 09:30 ET is 14:30 London, except in the two "gap" windows where only one side has moved (13:30).
  it.each([
    ['Mar 6  (EST / GMT)', et(2026, 3, 6, 9, 30), '2026-03-06 14:30', '2026-03-06 14:30'],
    ['Mar 10 (EDT / GMT — US moved, UK not yet)', et(2026, 3, 10, 9, 30), '2026-03-10 13:30', '2026-03-10 13:30'],
    ['Mar 30 (EDT / BST)', et(2026, 3, 30, 9, 30), '2026-03-30 14:30', '2026-03-30 13:30'],
    ['Oct 27 (EDT / GMT — UK moved back, US not yet)', et(2026, 10, 27, 9, 30), '2026-10-27 13:30', '2026-10-27 13:30'],
    ['Nov 3  (EST / GMT)', et(2026, 11, 3, 9, 30), '2026-11-03 14:30', '2026-11-03 14:30'],
  ])('%s', (_label, t, london, utc) => {
    expect(wall(chartTimeInZone(t, 'Europe/London'))).toBe(london)
    expect(wall(chartTimeInZone(t, 'UTC'))).toBe(utc)
  })

  it('across the New York transitions themselves (the bars around Mar 8 and Nov 1 2026)', () => {
    // Fri before / Mon after spring-forward: the UTC reading moves by an hour, the ET label does not.
    expect(wall(chartTimeInZone(et(2026, 3, 6, 16, 0), 'UTC'))).toBe('2026-03-06 21:00')
    expect(wall(chartTimeInZone(et(2026, 3, 9, 16, 0), 'UTC'))).toBe('2026-03-09 20:00')
    // Fri before / Mon after fall-back.
    expect(wall(chartTimeInZone(et(2026, 10, 30, 16, 0), 'UTC'))).toBe('2026-10-30 20:00')
    expect(wall(chartTimeInZone(et(2026, 11, 2, 16, 0), 'UTC'))).toBe('2026-11-02 21:00')
    // Chicago and Los Angeles switch with New York: always 1h / 3h behind.
    for (const t of [et(2026, 3, 6, 9, 30), et(2026, 3, 10, 9, 30), et(2026, 11, 3, 9, 30)]) {
      expect(chartTimeInZone(t, 'America/Chicago')).toBe(t - 3600)
      expect(chartTimeInZone(t, 'America/Los_Angeles')).toBe(t - 3 * 3600)
    }
  })

  it('zones a day ahead roll the date (Tokyo, Sydney, Hong Kong)', () => {
    expect(wall(chartTimeInZone(et(2026, 1, 15, 20, 0), 'Asia/Tokyo'))).toBe('2026-01-16 10:00')
    expect(wall(chartTimeInZone(et(2026, 7, 14, 9, 30), 'Asia/Tokyo'))).toBe('2026-07-14 22:30')
    expect(wall(chartTimeInZone(et(2026, 1, 15, 9, 30), 'Australia/Sydney'))).toBe('2026-01-16 01:30')   // AEDT +11
    expect(wall(chartTimeInZone(et(2026, 7, 14, 9, 30), 'Australia/Sydney'))).toBe('2026-07-14 23:30')   // AEST +10
    expect(wall(chartTimeInZone(et(2026, 7, 14, 9, 30), 'Asia/Hong_Kong'))).toBe('2026-07-14 21:30')
  })

  it('New York, no zone, and non-numeric times come back untouched', () => {
    const t = et(2026, 7, 14, 9, 30)
    expect(chartTimeInZone(t, null)).toBe(t)
    expect(chartTimeInZone(t, 'America/New_York')).toBe(t)
    expect(chartTimeInZone('2026-07-14', 'Asia/Tokyo')).toBe('2026-07-14')
    // the zone read agrees with barTime's own ET conversion at the same instant
    const unix = Date.UTC(2026, 6, 14, 13, 30) / 1000
    expect(wallSecIn(unix, 'America/New_York')).toBe(toChartTime(unix))
  })

  it('ids map to IANA zones; Exchange / unknown = none; Local = the browser\'s', () => {
    expect(ianaZoneFor('exchange')).toBe(null)
    expect(ianaZoneFor(undefined)).toBe(null)
    expect(ianaZoneFor('mars')).toBe(null)
    expect(ianaZoneFor('london')).toBe('Europe/London')
    expect(ianaZoneFor('frankfurt')).toBe('Europe/Berlin')
    expect(ianaZoneFor('local')).toBe(browserTimeZone())
    expect(TIME_ZONES.map((z) => z[1])).toEqual([
      'Exchange (New York)', 'Local (browser)', 'UTC', 'Chicago', 'Los Angeles', 'London', 'Frankfurt', 'Tokyo', 'Hong Kong', 'Sydney',
    ])
    for (const [, , iana] of TIME_ZONES) {
      if (iana) expect(() => new Intl.DateTimeFormat('en-US', { timeZone: iana })).not.toThrow()
    }
  })
})

describe('timeAxisFormattersFor — the axis + crosshair labels', () => {
  it('Exchange (absent) hands back the ORIGINAL formatter references (today\'s chart unchanged)', () => {
    expect(timeAxisFormattersFor(false, 'exchange', false)).toEqual({ tick: chartTickMarkFormatter, crosshair: chartCrosshairTimeFormatter })
    expect(timeAxisFormattersFor(true, 'exchange', false)).toEqual({ tick: chartTickMarkFormatter24, crosshair: chartCrosshairTimeFormatter24 })
    expect(timeAxisFormattersFor(false, 'exchange', true).tick).toBe(studyTickMarkFormatter)
    expect(timeAxisFormattersFor(true, 'exchange', true).tick).toBe(studyTickMarkFormatter24)
  })

  it('another zone: ONE stable pair per combination', () => {
    expect(timeAxisFormattersFor(false, 'london')).toBe(timeAxisFormattersFor(false, 'london'))
    expect(timeAxisFormattersFor(true, 'london')).not.toBe(timeAxisFormattersFor(false, 'london'))
  })

  it('London 12 / 24-hour, both sides of the gap weeks', () => {
    const l12 = timeAxisFormattersFor(false, 'london'), l24 = timeAxisFormattersFor(true, 'london')
    expect(l12.tick(et(2026, 3, 6, 9, 30), 3)).toBe('2:30 PM')
    expect(l12.tick(et(2026, 3, 10, 9, 30), 3)).toBe('1:30 PM')
    expect(l24.tick(et(2026, 3, 30, 9, 30), 3)).toBe('14:30')
    expect(l24.tick(et(2026, 10, 27, 9, 30), 3)).toBe('13:30')
    expect(l24.crosshair(et(2026, 11, 3, 9, 30))).toBe("Tue 3 Nov '26 14:30")
    expect(l12.crosshair(et(2026, 3, 10, 9, 30))).toBe("Tue 10 Mar '26 1:30 PM")
    // the library passes a locale third: it never switches the hour cycle
    expect(l12.tick(et(2026, 3, 6, 9, 30), 3, 'en-GB')).toBe('2:30 PM')
  })

  it('a day-boundary tick and the crosshair carry the zone\'s DATE (Tokyo, after the US close)', () => {
    const tk = timeAxisFormattersFor(true, 'tokyo')
    expect(tk.crosshair(et(2026, 1, 15, 20, 0))).toBe("Fri 16 Jan '26 10:00")
    expect(tk.tick(et(2026, 1, 15, 20, 0), 2)).toBe('Jan 16')
  })

  it('daily+ labels are dates and never change with the zone', () => {
    for (const id of ['utc', 'tokyo', 'sydney', 'local']) {
      const f = timeAxisFormattersFor(false, id), s = timeAxisFormattersFor(false, id, true)
      expect(f.tick('2026-07-14', 2)).toBe(chartTickMarkFormatter('2026-07-14', 2))
      expect(f.tick('2026-07-14', 1)).toBe(chartTickMarkFormatter('2026-07-14', 1))
      expect(f.crosshair('2026-07-14')).toBe(chartCrosshairTimeFormatter('2026-07-14'))
      expect(s.tick('2026-03-04', 2)).toBe(studyTickMarkFormatter('2026-03-04', 2))
    }
  })
})

describe('storage: scaleTime.timeZone', () => {
  it('absent / junk / exchange read as Exchange and emit no key', () => {
    expect(timeZoneOf({})).toBe('exchange')
    expect(timeZoneOf({ scaleTime: { timeZone: 'Europe/London' } })).toBe('exchange')
    expect(sanitizeScaleTime({ timeZone: 'exchange' })).toBe(null)
    expect(sanitizeScaleTime({ timeZone: 'mars' })).toBe(null)
    expect('scaleTime' in mergeChartSettings(JSON.stringify({ scaleTime: { timeZone: 'exchange' } }))).toBe(false)
  })
  it('a real zone round-trips beside the other fields; the patch removes Exchange', () => {
    expect(mergeChartSettings(JSON.stringify({ scaleTime: { timeZone: 'sydney', timeFormat: '24' } })).scaleTime)
      .toEqual({ timeFormat: '24', timeZone: 'sydney' })
    expect(scaleTimePatch({ scaleTime: { timeZone: 'utc', rightMargin: 3 } }, 'timeZone', 'exchange')).toEqual({ scaleTime: { rightMargin: 3 } })
    expect(scaleTimePatch({}, 'timeZone', 'hong_kong')).toEqual({ scaleTime: { timeZone: 'hong_kong' } })
    expect(scaleTimePatch({}, 'timeZone', 'mars')).toEqual({ scaleTime: {} })
  })
})

describe('Shade pre / post-market reads the existing extendedHoursShading', () => {
  it('agrees with resolveShowExtended (the one rule every surface uses)', () => {
    for (const cs of [{}, null, { extendedHoursShading: true }, { extendedHoursShading: false }, mergeChartSettings('{}')]) {
      expect(extendedHoursOf(cs)).toBe(resolveShowExtended(cs, null))
    }
  })
})
