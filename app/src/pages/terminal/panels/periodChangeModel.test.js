// PCHG, the pure half. Rails:
//   * the words a range and a list end are typed as, and the command arguments a pick writes;
//   * a typed date is read in three spellings and an impossible one is refused;
//   * the one-click ranges start from the last day BEFORE the period;
//   * a request is refused before it is sent when a date is impossible, in the future, out of
//     order or before the floor (the service has no check of its own);
//   * the route's answer: ok, computing, unavailable, refused and not-this-route are five states;
//     a row with no percent is dropped, never drawn as 0; the days the server used are reported,
//     and two dates on one trading day are flagged;
//   * wave 5: the words for what is ranked collide with no range or list-end word; the groups
//     route's answer has the same five states; a group's stocks take their own change from the
//     stock ranking, and one it does not hold has no percent (never a 0).
// The fixtures are the route's real shape (api/services/scan_period.py _assemble), made-up tickers.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PERIOD_RANGE, DEFAULT_PERIOD_UNIT, PERIOD_CHANGE_CODE, PERIOD_FLOOR, PERIOD_RANGES, PERIOD_RANGE_ARG_WORDS, PERIOD_SIDES,
  PERIOD_SIDE_ARG_WORDS, PERIOD_UNITS, PERIOD_UNIT_ARG_WORDS, WHOLE_MARKET_HISTORY_FROM, breadthOf, dayOfYmd, groupMemberRows,
  normPeriodSide, normPeriodUnit, parsePeriodDate, parsePeriodRange, parsePeriodSide, parsePeriodUnit, periodChangeCommandArgs,
  periodChangeUrl, periodGroupsRead, periodGroupsUrl, periodRead, periodRequest, rangeDates, shiftDay, sideRows, snapNote,
} from './periodChangeModel'
import PRESET_CASES from './periodPresets.fixture.json'

const TODAY = '2026-11-17'
const OK = {
  status: 'ok',
  results: [
    { sym: 'AAA', period_change: 212.5, net_change: 21.25, start_close: 10.0, end_close: 31.25, price: 31.4, volume: 1200000, industry: 'Semiconductors', sector: 'Technology' },
    { sym: 'bbb', period_change: 4.0, net_change: 2.0, start_close: 50.0, end_close: 52.0, price: null, volume: null, industry: null, sector: 'Energy' },
    { sym: 'CCC', period_change: 0.0, net_change: 0.0, start_close: 8.0, end_close: 8.0, price: 8.0, volume: 10, industry: null, sector: null },
    { sym: 'DDD', period_change: -61.3, net_change: -30.65, start_close: 50.0, end_close: 19.35, price: 19.3, volume: 90000, industry: 'Biotechnology', sector: 'Healthcare' },
  ],
  count: 4,
  start: 20251231,
  end: 20261116,
  as_of: '2026-11-17T09:41:00-05:00',
  partial: false,
}

describe('PCHG words and command arguments', () => {
  it('the code, the ranges and the words they are typed as', () => {
    expect(PERIOD_CHANGE_CODE).toBe('PCHG')
    expect(Object.keys(PERIOD_RANGES)).toEqual(['mtd', 'qtd', 'ytd', 'm1', 'm3', 'm6', 'y1'])
    expect(DEFAULT_PERIOD_RANGE).toBe('ytd')
    for (const [raw, want] of [['MTD', 'mtd'], ['month', 'mtd'], ['qtd', 'qtd'], ['Quarter', 'qtd'], ['YTD', 'ytd'], ['year', 'ytd'],
      ['1M', 'm1'], ['3m', 'm3'], ['6M', 'm6'], ['1Y', 'y1'], [' 12M ', 'y1']]) expect(parsePeriodRange(raw), String(raw)).toBe(want)
    for (const bad of [null, undefined, '', '2M', 'nonsense', 'toString', 'constructor', 7]) expect(parsePeriodRange(bad), String(bad)).toBeNull()
    // every token a chip writes is a word the reader gives back as the same range
    for (const [key, r] of Object.entries(PERIOD_RANGES)) expect(parsePeriodRange(r.token), key).toBe(key)
    expect(new Set(Object.values(PERIOD_RANGE_ARG_WORDS))).toEqual(new Set(Object.keys(PERIOD_RANGES)))
  })

  it('the two ends of the list', () => {
    for (const [raw, want] of [['LOSERS', 'losers'], ['down', 'losers'], ['Worst', 'losers'], ['bottom', 'losers'], ['GAINERS', 'gainers'],
      ['up', 'gainers'], ['TOP', 'gainers']]) expect(parsePeriodSide(raw), raw).toBe(want)
    for (const bad of [null, '', 'sideways', 'valueOf']) expect(parsePeriodSide(bad), String(bad)).toBeNull()
    expect(normPeriodSide('sideways')).toBe('gainers')
    expect(normPeriodSide('LOSERS')).toBe('losers')
    for (const [key, s] of Object.entries(PERIOD_SIDES)) if (s.token) expect(parsePeriodSide(s.token)).toBe(key)
    expect(new Set(Object.values(PERIOD_SIDE_ARG_WORDS))).toEqual(new Set(Object.keys(PERIOD_SIDES)))
    // no word is both a range and a list end, so the two kinds can share one command
    for (const w of Object.keys(PERIOD_SIDE_ARG_WORDS)) expect(parsePeriodRange(w), w).toBeNull()
  })

  it('the arguments a pick writes: the default range and the gainers are the bare command', () => {
    expect(periodChangeCommandArgs()).toEqual([])
    expect(periodChangeCommandArgs({ range: 'ytd', side: 'gainers' })).toEqual([])
    expect(periodChangeCommandArgs({ range: 'qtd' })).toEqual(['QTD'])
    expect(periodChangeCommandArgs({ range: 'QTD', side: 'losers' })).toEqual(['QTD', 'LOSERS'])
    expect(periodChangeCommandArgs({ range: 'ytd', side: 'LOSERS' })).toEqual(['LOSERS'])
    // typed dates win over a range; a start alone is "since that day"
    expect(periodChangeCommandArgs({ range: 'qtd', start: '2026-01-02', end: '2026-06-30' })).toEqual(['2026-01-02', '2026-06-30'])
    expect(periodChangeCommandArgs({ start: '1/2/2026', side: 'losers' })).toEqual(['2026-01-02', 'LOSERS'])
    // an end with no start is not a request, so it writes nothing
    expect(periodChangeCommandArgs({ end: '2026-06-30' })).toEqual([])
    // every date token written reads back as the same date
    for (const tok of periodChangeCommandArgs({ start: '2026-01-02', end: '2026-06-30' })) expect(parsePeriodDate(tok)).toBe(tok)
  })
})

describe('PCHG dates', () => {
  it('reads three spellings as one calendar date and refuses anything that is not a real day', () => {
    expect(parsePeriodDate('2026-01-02')).toBe('2026-01-02')
    expect(parsePeriodDate('2026-1-2')).toBe('2026-01-02')
    expect(parsePeriodDate('20260102')).toBe('2026-01-02')
    expect(parsePeriodDate(20260102)).toBe('2026-01-02')
    expect(parsePeriodDate('1/2/2026')).toBe('2026-01-02')
    expect(parsePeriodDate(' 12/31/2025 ')).toBe('2025-12-31')
    expect(parsePeriodDate('2024-02-29')).toBe('2024-02-29')
    for (const bad of [null, undefined, '', 'yesterday', '2026-02-30', '2026-13-01', '2025-02-29', '20260230', '13/40/2026', '2026-01', '1/2',
      '2026-01-02T00:00:00', '0000-01-01']) expect(parsePeriodDate(bad), String(bad)).toBeNull()
    expect(dayOfYmd(20261116)).toBe('2026-11-16')
    expect(dayOfYmd(null)).toBeNull()
    expect(dayOfYmd(undefined)).toBeNull()
  })

  it('shiftDay moves by whole days across a month, a year and a leap day', () => {
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29')
    expect(shiftDay('2026-03-08', 1)).toBe('2026-03-09')   // a clock-change day is still one day
    expect(shiftDay('nonsense', 1)).toBeNull()
  })

  it('the one-click ranges start from the last day before the period', () => {
    expect(rangeDates('mtd', TODAY)).toEqual({ start: '2026-10-31', end: TODAY })
    // ONE table for the client and the server: scan_period.preset_ranges keeps these seven ranges
    // built, by the same dates (tests/test_scan_period_presets.py reads the same file).
    expect(PRESET_CASES.length).toBeGreaterThanOrEqual(5)
    for (const c of PRESET_CASES) {
      for (const key of ['mtd', 'qtd', 'ytd', 'm1', 'm3', 'm6', 'y1']) {
        expect([c.today, key, rangeDates(key, c.today)]).toEqual([c.today, key, { start: c[key], end: c.today }])
      }
    }
    expect(rangeDates('qtd', TODAY)).toEqual({ start: '2026-09-30', end: TODAY })
    expect(rangeDates('ytd', TODAY)).toEqual({ start: '2025-12-31', end: TODAY })
    expect(rangeDates('m1', TODAY)).toEqual({ start: '2026-10-17', end: TODAY })
    expect(rangeDates('m3', TODAY)).toEqual({ start: '2026-08-17', end: TODAY })
    expect(rangeDates('m6', TODAY)).toEqual({ start: '2026-05-17', end: TODAY })
    expect(rangeDates('y1', TODAY)).toEqual({ start: '2025-11-17', end: TODAY })
    // the first quarter and January reach back into the year before
    expect(rangeDates('qtd', '2026-02-10')).toEqual({ start: '2025-12-31', end: '2026-02-10' })
    expect(rangeDates('mtd', '2026-01-05')).toEqual({ start: '2025-12-31', end: '2026-01-05' })
    expect(rangeDates('qtd', '2026-06-30').start).toBe('2026-03-31')
    // a month with fewer days clamps to its last day, never rolls into the next month
    expect(rangeDates('m3', '2026-05-31').start).toBe('2026-02-28')
    expect(rangeDates('m1', '2026-03-31').start).toBe('2026-02-28')
    expect(rangeDates('y1', '2024-02-29').start).toBe('2023-02-28')
    expect(rangeDates('nonsense', TODAY)).toBeNull()
    expect(rangeDates('ytd', 'soon')).toBeNull()
  })
})

describe('PCHG request', () => {
  it('no dates is the range, and no range is year to date', () => {
    expect(periodRequest({ today: TODAY })).toEqual({
      ok: true, range: 'ytd', start: '2025-12-31', end: TODAY, url: '/api/scans/period-change?start=20251231&end=20261117', endIsToday: true,
    })
    expect(periodRequest({ range: 'QTD', today: TODAY })).toMatchObject({ ok: true, range: 'qtd', start: '2026-09-30', end: TODAY })
    expect(periodRequest({ range: 'm6', today: TODAY })).toMatchObject({ ok: true, range: 'm6', start: '2026-05-17' })
    expect(periodRequest({ range: 'nonsense', today: TODAY })).toMatchObject({ ok: true, range: 'ytd' })
    expect(periodChangeUrl('2026-01-02', '2026-06-30')).toBe('/api/scans/period-change?start=20260102&end=20260630')
  })

  it('typed dates win over a range; a start alone runs to today', () => {
    expect(periodRequest({ range: 'qtd', start: '2026-01-02', end: '2026-06-30', today: TODAY })).toEqual({
      ok: true, range: null, start: '2026-01-02', end: '2026-06-30', url: '/api/scans/period-change?start=20260102&end=20260630', endIsToday: false,
    })
    expect(periodRequest({ start: '1/2/2026', today: TODAY })).toMatchObject({ ok: true, range: null, start: '2026-01-02', end: TODAY, endIsToday: true })
    expect(periodRequest({ start: '2026-01-02', end: TODAY, today: TODAY })).toMatchObject({ ok: true, endIsToday: true })
  })

  it('refuses, with a sentence, every pair the service would mishandle', () => {
    const refused = (args) => { const r = periodRequest({ today: TODAY, ...args }); expect(r.ok, JSON.stringify(args)).toBe(false); expect(r.url).toBeUndefined(); return r }
    // an impossible day would be a 500 on the server
    expect(refused({ start: '2026-02-30', end: '2026-06-30' })).toMatchObject({ problem: 'start', message: '"2026-02-30" is not a date this panel can read. Use YYYY-MM-DD.' })
    expect(refused({ start: '2026-01-02', end: 'soon' })).toMatchObject({ problem: 'end', message: '"soon" is not a date this panel can read. Use YYYY-MM-DD.' })
    // a future end would answer "computing" for ever
    expect(refused({ start: '2026-01-02', end: '2026-11-18' })).toMatchObject({ problem: 'future', message: 'The end date 2026-11-18 is after today (2026-11-17). No stock has traded then yet.' })
    expect(refused({ start: '2027-01-02' })).toMatchObject({ problem: 'future', message: 'The start date 2027-01-02 is after today (2026-11-17). No stock has traded then yet.' })
    expect(refused({ start: '2026-06-30', end: '2026-01-02' })).toMatchObject({ problem: 'order', message: 'The start date 2026-06-30 has to be before the end date 2026-01-02.' })
    expect(refused({ start: '2026-06-30', end: '2026-06-30' }).problem).toBe('order')
    expect(refused({ start: TODAY }).problem).toBe('order')       // since today is no range at all
    expect(refused({ end: '2026-06-30' })).toMatchObject({ problem: 'start', message: 'Pick a start date as well as an end date.' })
    expect(refused({ start: '1989-12-29', end: '2026-06-30' })).toMatchObject({ problem: 'floor', message: `The start date has to be ${PERIOD_FLOOR} or later.` })
    expect(periodRequest({ range: 'ytd', today: 'nonsense' })).toMatchObject({ ok: false, problem: 'today' })
    expect(periodRequest()).toMatchObject({ ok: false, problem: 'today' })
  })
})

describe('PCHG periodRead', () => {
  it('the rows, biggest gainer first, with the days the server used', () => {
    const out = periodRead(OK)
    expect(out.state).toBe('ok')
    expect(out.rows.map((r) => [r.sym, r.pct, r.dollars])).toEqual([['AAA', 212.5, 21.25], ['BBB', 4, 2], ['CCC', 0, 0], ['DDD', -61.3, -30.65]])
    // the percent is the percent the server sends: never multiplied again
    expect(out.rows[0]).toEqual({ key: 'pchg-AAA', sym: 'AAA', pct: 212.5, dollars: 21.25, startClose: 10, endClose: 31.25, price: 31.4, industry: 'Semiconductors', sector: 'Technology' })
    expect(out.rows[1]).toMatchObject({ price: null, industry: null, sector: 'Energy' })
    expect(out).toMatchObject({ startDay: '2025-12-31', endDay: '2026-11-16', sameDay: false, partial: false, coverage: null, asOf: '2026-11-17T09:41:00-05:00' })
  })

  it('a row with no percent or no ticker is dropped (never a 0), a stock sent twice is one row, and the order is by percent', () => {
    const out = periodRead({ ...OK, results: [
      { sym: 'LOW', period_change: -5 }, { sym: 'NOPCT', period_change: null }, { period_change: 9 }, null, { sym: 'TOP', period_change: '40.5' },
      { sym: 'top', period_change: 1 }, { sym: 'BOOL', period_change: true }, { sym: 'TIE1', period_change: 2 }, { sym: 'TIE2', period_change: 2 },
    ] })
    expect(out.rows.map((r) => [r.sym, r.pct])).toEqual([['TOP', 40.5], ['TIE1', 2], ['TIE2', 2], ['LOW', -5]])
    expect(out.rows.every((r) => r.startClose === null && r.endClose === null && r.dollars === null)).toBe(true)
  })

  it('computing, unavailable, refused and not-this-route are four states, none of them an empty list', () => {
    expect(periodRead({ status: 'computing', results: [], count: 0, as_of: null })).toMatchObject({ state: 'computing', rows: [] })
    expect(periodRead({ status: 'unavailable', results: [], count: 0, error: 'not this far back', as_of: null })).toMatchObject({ state: 'unavailable', rows: [] })
    expect(periodRead({ status: 'error', results: [], count: 0, error: 'start must be before end' })).toMatchObject({ state: 'refused', rows: [] })
    for (const body of [undefined, null, [], 'x', {}, { results: [] }, { status: 'ok' }, { status: 'ok', results: 'none' }, { detail: 'Scanner presets require a paid plan' }]) {
      expect(periodRead(body).state, JSON.stringify(body)).toBe('failed')
    }
    expect(periodRead({ ...OK, results: [] })).toMatchObject({ state: 'ok', rows: [], startDay: '2025-12-31' })
  })

  it('flags two dates that landed on one trading day, the bar-store path and a coverage receipt that reads', () => {
    expect(periodRead({ ...OK, start: 20261116, end: 20261116 }).sameDay).toBe(true)
    expect(periodRead({ ...OK, start: undefined }).sameDay).toBe(false)
    expect(periodRead({ ...OK, partial: true }).partial).toBe(true)
    expect(periodRead({ ...OK, partial: 'yes' }).partial).toBe(false)
    const coverage = { evaluated: 5300, answered: 4812, dropped: 78, not_computable: 410, dropped_symbols: [{ ticker: 'QH', reason: 'dropped' }] }
    expect(periodRead({ ...OK, coverage }).coverage).toEqual({ evaluated: 5300, ranked: 4812, leftOut: 78, noPrice: 410 })
    expect(periodRead({ ...OK, coverage: { evaluated: 5300, answered: 4812 } }).coverage).toBeNull()
    expect(periodRead({ ...OK, coverage: 'armed' }).coverage).toBeNull()
  })
})

describe('PCHG list ends, breadth and the snap note', () => {
  const rows = periodRead(OK).rows
  it('gainers are the biggest gains first, losers the biggest falls first, and a cut is reported', () => {
    expect(sideRows(rows, 'gainers').rows.map((r) => r.sym)).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
    expect(sideRows(rows, 'losers').rows.map((r) => r.sym)).toEqual(['DDD', 'CCC', 'BBB', 'AAA'])
    expect(sideRows(rows, 'LOSERS', 2)).toMatchObject({ total: 4, cut: true })
    expect(sideRows(rows, 'losers', 2).rows.map((r) => r.sym)).toEqual(['DDD', 'CCC'])
    expect(sideRows(rows, 'gainers', 4).cut).toBe(false)
    expect(sideRows(null, 'gainers', 5)).toEqual({ rows: [], total: 0, cut: false })
    // the caller's rows are not reordered in place
    expect(rows.map((r) => r.sym)).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
  })

  it('breadth counts rose, fell and did not move', () => {
    expect(breadthOf(rows)).toEqual({ up: 2, down: 1, flat: 1 })
    expect(breadthOf(null)).toEqual({ up: 0, down: 0, flat: 0 })
  })

  it('the snap note says which date the server moved, and nothing about a date it did not send back', () => {
    expect(snapNote({ askedStart: '2025-12-31', askedEnd: '2026-11-17', startDay: '2025-12-31', endDay: '2026-11-16' })).toEqual({ startMoved: false, endMoved: true })
    expect(snapNote({ askedStart: '2026-10-31', askedEnd: '2026-11-16', startDay: '2026-10-30', endDay: '2026-11-16' })).toEqual({ startMoved: true, endMoved: false })
    expect(snapNote({ askedStart: '2026-10-31', askedEnd: '2026-11-16', startDay: null, endDay: null })).toEqual({ startMoved: false, endMoved: false })
  })
})

// ── wave 5: sectors, industries and themes over the same two dates ──────────────────────────
// The fixture is the groups route's real shape (api/services/scan_period.py
// get_period_change_groups), made-up names and tickers.
const GROUPS_OK = {
  status: 'ok',
  group: 'sector',
  results: [
    { name: 'Technology', period_change: 38.25, count: 3, members: ['AAA', 'EEE', 'FFF'] },
    { name: 'Energy', period_change: 4.0, count: 1, members: ['BBB'] },
    { name: 'Healthcare', period_change: -61.3, count: 1, members: ['DDD'] },
  ],
  count: 3,
  start: 20251231,
  end: 20261116,
  as_of: '2026-11-17T09:41:00-05:00',
}

describe('PCHG what to rank', () => {
  it('the four units, the words they are typed as, and the token each chip writes', () => {
    expect(Object.keys(PERIOD_UNITS)).toEqual(['stocks', 'sector', 'industry', 'theme'])
    expect(DEFAULT_PERIOD_UNIT).toBe('stocks')
    for (const [raw, want] of [['STOCKS', 'stocks'], ['stock', 'stocks'], ['SECTORS', 'sector'], ['Sector', 'sector'], ['industries', 'industry'],
      ['INDUSTRY', 'industry'], [' themes ', 'theme'], ['THEME', 'theme']]) expect(parsePeriodUnit(raw), raw).toBe(want)
    for (const bad of [null, undefined, '', 'GROUPS', 'etf', 'toString', 'constructor', 7]) expect(parsePeriodUnit(bad), String(bad)).toBeNull()
    for (const [key, u] of Object.entries(PERIOD_UNITS)) if (u.token) expect(parsePeriodUnit(u.token), key).toBe(key)
    expect(PERIOD_UNITS.stocks.token).toBeNull()
    expect(new Set(Object.values(PERIOD_UNIT_ARG_WORDS))).toEqual(new Set(Object.keys(PERIOD_UNITS)))
    // a prop may carry the typed word or the key itself; anything else is the stocks
    expect(normPeriodUnit('SECTORS')).toBe('sector')
    expect(normPeriodUnit('industry')).toBe('industry')
    for (const other of [null, undefined, '', 'nonsense', 'constructor', 7]) expect(normPeriodUnit(other), String(other)).toBe('stocks')
  })

  it('no word is shared with a range or a list end, so the three kinds share one command', () => {
    for (const w of Object.keys(PERIOD_UNIT_ARG_WORDS)) {
      expect(parsePeriodRange(w), w).toBeNull()
      expect(parsePeriodSide(w), w).toBeNull()
    }
    for (const w of [...Object.keys(PERIOD_RANGE_ARG_WORDS), ...Object.keys(PERIOD_SIDE_ARG_WORDS)]) expect(parsePeriodUnit(w), w).toBeNull()
    // and no unit word reads as a date
    for (const w of Object.keys(PERIOD_UNIT_ARG_WORDS)) expect(parsePeriodDate(w), w).toBeNull()
  })

  it('the arguments a pick writes: the unit sits between the range and the list end, and the stocks write nothing', () => {
    expect(periodChangeCommandArgs({ unit: 'stocks' })).toEqual([])
    expect(periodChangeCommandArgs({ unit: 'sector' })).toEqual(['SECTORS'])
    expect(periodChangeCommandArgs({ range: 'qtd', unit: 'INDUSTRIES', side: 'losers' })).toEqual(['QTD', 'INDUSTRIES', 'LOSERS'])
    expect(periodChangeCommandArgs({ start: '2026-01-02', end: '2026-06-30', unit: 'theme' })).toEqual(['2026-01-02', '2026-06-30', 'THEMES'])
    expect(periodChangeCommandArgs({ unit: 'nonsense', side: 'losers' })).toEqual(['LOSERS'])
  })

  it('the groups route for a unit, and none for the stocks', () => {
    expect(periodGroupsUrl('2026-01-02', '2026-06-30', 'sector')).toBe('/api/scans/period-change-groups?start=20260102&end=20260630&group=sector')
    expect(periodGroupsUrl('2026-01-02', '2026-06-30', 'industry')).toContain('&group=industry')
    expect(periodGroupsUrl('2026-01-02', '2026-06-30', 'theme')).toContain('&group=theme')
    for (const none of ['stocks', 'SECTORS', 'nonsense', null, 'constructor']) expect(periodGroupsUrl('2026-01-02', '2026-06-30', none), String(none)).toBeNull()
  })
})

describe('PCHG periodGroupsRead', () => {
  it('the groups, biggest gain first, with their stock counts, their stocks and the days the server used', () => {
    const out = periodGroupsRead(GROUPS_OK, 'sector')
    expect(out.state).toBe('ok')
    expect(out.rows).toEqual([
      { key: 'pchg-sector-Technology', name: 'Technology', pct: 38.25, count: 3, members: ['AAA', 'EEE', 'FFF'] },
      { key: 'pchg-sector-Energy', name: 'Energy', pct: 4, count: 1, members: ['BBB'] },
      { key: 'pchg-sector-Healthcare', name: 'Healthcare', pct: -61.3, count: 1, members: ['DDD'] },
    ])
    expect(out).toMatchObject({ startDay: '2025-12-31', endDay: '2026-11-16', sameDay: false, mayBePartial: false, coverage: null, asOf: '2026-11-17T09:41:00-05:00' })
    // the two list helpers written for stocks read these rows too
    expect(sideRows(out.rows, 'losers', 2).rows.map((r) => r.name)).toEqual(['Healthcare', 'Energy'])
    expect(breadthOf(out.rows)).toEqual({ up: 2, down: 1, flat: 0 })
  })

  it('a group with no percent or no name is dropped (never a 0), a name sent twice is one row, and a missing count is not a 0', () => {
    const out = periodGroupsRead({ ...GROUPS_OK, results: [
      { name: 'Low', period_change: -5, count: 2, members: ['a', 'A', ' b '] }, { name: 'NoPct', period_change: null, count: 4 }, { period_change: 9 }, null,
      { name: 'Top', period_change: '40.5', members: ['X', 'Y'] }, { name: 'top', period_change: 1 }, { name: 'Bare', period_change: 2 },
      { name: 'ZeroCount', period_change: 1.5, count: 0, members: [] },
    ] }, 'sector')
    expect(out.rows.map((r) => [r.name, r.pct, r.count, r.members])).toEqual([
      ['Top', 40.5, 2, ['X', 'Y']], ['Bare', 2, null, []], ['ZeroCount', 1.5, null, []], ['Low', -5, 2, ['A', 'B']],
    ])
  })

  it('computing, unavailable, refused and not-this-read are four states, none of them an empty list', () => {
    expect(periodGroupsRead({ status: 'computing', group: 'sector', results: [], count: 0, error: null }, 'sector')).toMatchObject({ state: 'computing', rows: [] })
    expect(periodGroupsRead({ status: 'unavailable', group: 'sector', results: [], count: 0, error: 'not this far back' }, 'sector').state).toBe('unavailable')
    expect(periodGroupsRead({ status: 'error', group: 'sector', results: [], count: 0, error: 'start must be before end' }, 'sector').state).toBe('refused')
    expect(periodGroupsRead({ status: 'error', group: 'etf', results: [], count: 0, error: 'bad group' }, 'sector').state).toBe('failed')
    // an answer for another group, the stock route's own answer, or an unknown unit is not this read
    expect(periodGroupsRead(GROUPS_OK, 'industry').state).toBe('failed')
    expect(periodGroupsRead(OK, 'sector').state).toBe('failed')
    expect(periodGroupsRead(GROUPS_OK, 'stocks').state).toBe('failed')
    for (const body of [undefined, null, [], 'x', {}, { status: 'ok', group: 'sector' }, { detail: 'Scanner presets require a paid plan' }]) {
      expect(periodGroupsRead(body, 'sector').state, JSON.stringify(body)).toBe('failed')
    }
    expect(periodGroupsRead({ ...GROUPS_OK, results: [] }, 'sector')).toMatchObject({ state: 'ok', rows: [], startDay: '2025-12-31' })
  })

  it('flags two dates on one trading day, a range older than the whole-market history, and a coverage receipt that reads', () => {
    expect(periodGroupsRead({ ...GROUPS_OK, start: 20261116, end: 20261116 }, 'sector').sameDay).toBe(true)
    expect(WHOLE_MARKET_HISTORY_FROM).toBe('2004-01-01')
    expect(periodGroupsRead({ ...GROUPS_OK, start: 19990104 }, 'sector').mayBePartial).toBe(true)
    expect(periodGroupsRead({ ...GROUPS_OK, start: 20040102 }, 'sector').mayBePartial).toBe(false)
    expect(periodGroupsRead({ ...GROUPS_OK, start: undefined }, 'sector').mayBePartial).toBe(false)
    const coverage = { evaluated: 5300, answered: 4812, dropped: 78, not_computable: 410, dropped_symbols: [] }
    expect(periodGroupsRead({ ...GROUPS_OK, coverage }, 'sector').coverage).toEqual({ evaluated: 5300, ranked: 4812, leftOut: 78, noPrice: 410 })
  })
})

describe('PCHG groupMemberRows', () => {
  const stocks = periodRead({ ...OK, results: [...OK.results, { sym: 'EEE', period_change: -3.5, net_change: -1, start_close: 20, end_close: 19 }] }).rows
  const tech = periodGroupsRead(GROUPS_OK, 'sector').rows[0]
  it('each stock of the group with its own change, biggest gain first; one the stock list does not hold comes last with no percent', () => {
    const out = groupMemberRows(tech, stocks)
    expect(out.rows.map((r) => [r.sym, r.pct])).toEqual([['AAA', 212.5], ['EEE', -3.5], ['FFF', null]])
    expect(out).toMatchObject({ total: 3, known: 2 })
    expect(out.rows[0]).toMatchObject({ startClose: 10, endClose: 31.25, dollars: 21.25, industry: 'Semiconductors' })
    expect(out.rows[2]).toEqual({ key: 'pchg-FFF', sym: 'FFF', pct: null, dollars: null, startClose: null, endClose: null, price: null, industry: null, sector: null })
  })
  it('the losers end reverses the stocks that have a change and still keeps the unknown last', () => {
    expect(groupMemberRows(tech, stocks, 'LOSERS').rows.map((r) => r.sym)).toEqual(['EEE', 'AAA', 'FFF'])
  })
  it('with no stock ranking on hand every stock is listed with no percent, in the order sent', () => {
    expect(groupMemberRows(tech, []).rows.map((r) => [r.sym, r.pct])).toEqual([['AAA', null], ['EEE', null], ['FFF', null]])
    expect(groupMemberRows(tech, null)).toMatchObject({ total: 3, known: 0 })
    expect(groupMemberRows(null, stocks)).toEqual({ rows: [], total: 0, known: 0 })
  })
})
