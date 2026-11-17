// PCHG, the pure half. Rails:
//   * the words a range and a list end are typed as, and the command arguments a pick writes;
//   * a typed date is read in three spellings and an impossible one is refused;
//   * the one-click ranges start from the last day BEFORE the period;
//   * a request is refused before it is sent when a date is impossible, in the future, out of
//     order or before the floor (the service has no check of its own);
//   * the route's answer: ok, computing, unavailable, refused and not-this-route are five states;
//     a row with no percent is dropped, never drawn as 0; the days the server used are reported,
//     and two dates on one trading day are flagged.
// The fixtures are the route's real shape (api/services/scan_period.py _assemble), made-up tickers.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PERIOD_RANGE, PERIOD_CHANGE_CODE, PERIOD_FLOOR, PERIOD_RANGES, PERIOD_RANGE_ARG_WORDS, PERIOD_SIDES, PERIOD_SIDE_ARG_WORDS,
  breadthOf, dayOfYmd, normPeriodSide, parsePeriodDate, parsePeriodRange, parsePeriodSide, periodChangeCommandArgs, periodChangeUrl,
  periodRead, periodRequest, rangeDates, shiftDay, sideRows, snapNote,
} from './periodChangeModel'

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
