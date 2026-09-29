// TERM-035 — the client half of the shared-fixture parity.
//
// tests/fixtures/market_calendar_cases.json is ALSO answered by
// tests/test_session_calendar.py; both runtimes read market_calendar.json and
// both must agree with every row. The horizon rail lives on the Python side.
import { describe, it, expect } from 'vitest'
import CASES from '../../../../tests/fixtures/market_calendar_cases.json'
import DATA from './market_calendar.json'
import {
  sessionAt, isTradingDay, closeTime, horizon, covers, isHalfDay, holidayName, CALENDAR_VERSION,
} from './sessionCalendar'
import * as legacy from './nyseCalendar'
import { sessionState } from './marketClock'

const etDate = (ts) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(ts))

describe('shared fixture: sessionAt', () => {
  it.each(CASES.sessions.map((c) => [c.ts, c.expect, c.why]))('%s -> %s (%s)', (ts, want) => {
    expect(sessionAt(ts)).toBe(want)
  })
})

describe('shared fixture: isTradingDay / closeTime', () => {
  it.each(CASES.days.map((c) => [c.date, c.trading_day, c.close_utc, c.why]))('%s trading=%s close=%s (%s)', (day, trading, closeUtc) => {
    expect(isTradingDay(day)).toBe(trading)
    const got = closeTime(day)
    if (closeUtc === null) expect(got).toBeNull()
    else expect(got.toISOString()).toBe(new Date(closeUtc).toISOString())
  })
})

describe('the fixture is not vacuous', () => {
  it('has enough half-day, DST and holiday rows and every session value', () => {
    const tags = CASES.sessions.map((c) => c.tag)
    expect(tags.filter((t) => t === 'half-day').length).toBeGreaterThanOrEqual(10)
    expect(tags.filter((t) => t === 'dst').length).toBeGreaterThanOrEqual(15)
    expect(new Set(CASES.sessions.map((c) => c.expect))).toEqual(new Set(['pre', 'rth', 'post', 'closed']))
  })
})

describe('no second list on the client', () => {
  // nyseCalendar.js is the client table marketClock.js reads today. On every
  // year it covers, its dates must equal the dataset's exactly.
  it.each(legacy.COVERED_YEARS.map((y) => [y]))('%i: holidays and half-days equal nyseCalendar.js', (year) => {
    const pick = (rows) => rows.map((r) => r.date).filter((d) => d.startsWith(String(year))).sort()
    expect(pick(DATA.holidays)).toEqual(pick(legacy[`NYSE_HOLIDAYS_${year}`]))
    expect(pick(DATA.early_closes)).toEqual(pick(legacy[`NYSE_EARLY_CLOSES_${year}`]))
  })

  it('marketClock.sessionState agrees with every fixture row inside its own coverage', () => {
    const map = { regular: 'rth', pre: 'pre', post: 'post', closed: 'closed' }
    const inCoverage = CASES.sessions.filter((c) => legacy.hasCoverage(Number(etDate(c.ts).slice(0, 4))))
    expect(inCoverage.length).toBeGreaterThanOrEqual(40) // the comparison is not vacuous
    for (const c of inCoverage) {
      expect([c.ts, map[sessionState(new Date(c.ts)).session]]).toEqual([c.ts, c.expect])
    }
  })
})

describe('horizon and helpers', () => {
  it('publishes the dataset horizon and version', () => {
    expect(horizon()).toBe(DATA.horizon)
    expect(CALENDAR_VERSION).toBe(DATA.version)
  })

  it('outside coverage degrades to weekday + hours and says so', () => {
    expect(covers('2029-01-15')).toBe(false)
    expect(isTradingDay('2029-01-15')).toBe(true)
    expect(covers('2028-12-29')).toBe(true)
  })

  it('reads a Date as its ET calendar date, not its UTC date', () => {
    // 00:30Z on 2026-11-26 is still Wed 2026-11-25 in New York.
    expect(isTradingDay(new Date('2026-11-26T00:30:00Z'))).toBe(true)
    expect(isTradingDay('2026-11-26')).toBe(false)
  })

  it('half-day and holiday helpers', () => {
    expect(isHalfDay('2026-11-27')).toBe(true)
    expect(isHalfDay('2026-11-26')).toBe(false)
    expect(holidayName('2026-11-26')).toBe('Thanksgiving Day')
    expect(holidayName('2026-11-27')).toBeNull()
  })

  it('rejects a malformed day and a non-instant', () => {
    expect(() => isTradingDay('2026-9-29')).toThrow(TypeError)
    expect(() => sessionAt('not a time')).toThrow(TypeError)
  })
})
