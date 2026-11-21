// ECON's pure half. Every value is invented (__fixtures__/economyFixture.js, in the route's real shape).
import { describe, it, expect } from 'vitest'
import {
  ECON_CODE, ECON_LATEST_URL, ECON_SYMBOLS, ECON_THEMES, changeOf, creditLines, daysBetween, econFailure, economyRead,
  measureOf, nextReleaseOf, pointsOf, releaseNote, releasesAhead, valueText, weekdayOf,
} from './economyModel'
import { ECON_ATTRIBUTIONS, ECON_TODAY, econAnswer, econSeries } from './__fixtures__/economyFixture'

const view = (opts) => economyRead(econAnswer(opts), { today: ECON_TODAY })
const rowOf = (v, key) => v.themes.flatMap((t) => t.rows).find((r) => r.key === key)

describe('the board it asks for', () => {
  it('five themes in the brief\'s order, each series once, in one request', () => {
    expect(ECON_CODE).toBe('ECON')
    expect(ECON_THEMES.map((t) => t.title)).toEqual(['Inflation', 'Jobs', 'Growth and spending', 'Housing', 'Rates and money'])
    expect(ECON_THEMES.map((t) => t.rows.length)).toEqual([5, 5, 4, 4, 3])
    expect(new Set(ECON_SYMBOLS).size).toBe(ECON_SYMBOLS.length)
    expect(ECON_SYMBOLS).toHaveLength(26)
    expect(ECON_THEMES.find((t) => t.key === 'rates').rows.map((r) => r.symbol)).toEqual(['USEFFR', 'UST10Y', 'USDOLLARIDX'])
    expect(ECON_LATEST_URL).toBe(`/api/econ/latest?symbols=${ECON_SYMBOLS.join(',')}`)
    expect(ECON_SYMBOLS.slice(0, 2)).toEqual(['USCPIYOY', 'USCPIMOM'])
    expect(ECON_THEMES.find((t) => t.key === 'growth').missing).toEqual(['Retail sales'])
  })
})

describe('a row: value in its own units, the print before, the change, the period, the release day', () => {
  it('an inflation row reads the server\'s year-over-year series with its month-over-month beside it', () => {
    const cpi = rowOf(view(), 'cpi')
    expect(cpi).toMatchObject({ state: 'ok', label: 'CPI', symbol: 'USCPIYOY', derived: true, sourceLine: 'UCT calculation from BLS data' })
    expect(cpi.latest).toMatchObject({ value: 2.9, text: '2.9%', period: 'Feb 2031', released: 'Mar 12' })
    expect(cpi.prior).toMatchObject({ value: 2.7, text: '2.7%', period: 'Jan 2031' })
    expect(cpi.change).toMatchObject({ kind: 'pts', text: '+0.2 pts', dir: 1 })
    expect(cpi.alt).toMatchObject({ label: 'm/m', text: '0.4%', period: 'Feb 2031', samePeriod: true })
    expect(cpi.measure).toBe('Change from a year earlier')
    expect(cpi.chartHref).toBe('/charts?sym=ECON%3AUSCPIYOY')
  })

  it('the units are the series\' own, scale included (thousands read as the whole number)', () => {
    const v = view()
    expect(rowOf(v, 'claims').latest.text).toBe('214,000')
    expect(rowOf(v, 'payrolls').latest.text).toBe('151.0K')
    expect(rowOf(v, 'openings').latest.text).toBe('7.26M')
    expect(rowOf(v, 'starts').latest.text).toBe('1,355,000')
    expect(rowOf(v, 'income').latest.text).toBe('$25.50T')
    expect(rowOf(v, 'production').latest.text).toBe('103.9')
    expect(rowOf(v, 'fed_funds').latest.text).toBe('3.58%')
    expect(rowOf(v, 'claims').latest.period).toBe('wk 3/15')
    expect(rowOf(v, 'gdp').latest.period).toBe('Q4 2030')
    expect(rowOf(v, 'ten_year').latest.period).toBe('Mar 18, 2031')
  })

  it('the change is quoted the way the market quotes it: points, basis points, a count, or percent of a level', () => {
    const v = view()
    expect(rowOf(v, 'unemployment').change.text).toBe('+0.1 pts')
    expect(rowOf(v, 'ten_year').change).toMatchObject({ kind: 'bp', text: '-4 bp', dir: -1 })
    expect(rowOf(v, 'fed_funds').change).toMatchObject({ kind: 'bp', text: '0 bp', dir: 0 })
    expect(rowOf(v, 'claims').change).toMatchObject({ kind: 'count', text: '-7,000' })
    expect(rowOf(v, 'payrolls').change.text).toBe('+8.0K')
    expect(rowOf(v, 'openings').change.text).toBe('-156.0K')
    expect(rowOf(v, 'production').change).toMatchObject({ kind: 'pct', text: '+0.5%' })
    expect(rowOf(v, 'starts').change.text).toBe('-3.4%')
    expect(rowOf(v, 'income').change.text).toBe('+0.3%')
    expect(rowOf(v, 'gdp').change.text).toBe('-0.7 pts')
  })

  it('the dollar index is drawn the way the 10-year is: its level on its day, the day before, the change (percent of a level)', () => {
    const d = rowOf(view(), 'dollar')
    expect(d).toMatchObject({ state: 'ok', label: 'Broad dollar index (Fed)', symbol: 'USDOLLARIDX', derived: false, frequency: 'D' })
    expect(d.latest).toMatchObject({ value: 121.2, text: '121.2', period: 'Mar 14, 2031', released: 'Mar 17' })
    expect(d.prior).toMatchObject({ value: 121.4, text: '121.4', period: 'Mar 13, 2031' })
    expect(d.change).toMatchObject({ kind: 'pct', text: '-0.2%', dir: -1 })
    expect(d.measure).toBe('Index level')
    expect(d.next).toMatchObject({ state: 'ok', date: '2031-03-24', text: 'Mar 24, 4:15 PM ET' })
    expect(d.chartHref).toBe('/charts?sym=ECON%3AUSDOLLARIDX')
  })

  it('says what each number is', () => {
    const v = view()
    expect(rowOf(v, 'gdp').measure).toBe('Change from the quarter before, at an annual rate')
    expect(rowOf(v, 'payrolls').measure).toBe('Change from the month before')
    expect(rowOf(v, 'unemployment').measure).toBe('Percent')
    expect(rowOf(v, 'production').measure).toBe('Index level')
    expect(rowOf(v, 'starts').measure).toBe('Level, at an annual rate')
    expect(rowOf(v, 'claims').measure).toBe('Level')
    expect(measureOf({ derivation: { op: 'mom_pct' } })).toBe('Change from the month before')
    expect(measureOf(null)).toBe('Level')
  })
})

describe('a missing value is words, never 0', () => {
  it('a period the agency published no figure for has no value, no text and no change', () => {
    const cpi = econSeries('USCPIYOY', { name: 'CPI YoY %', op: 'yoy_pct',
      points: [[1928669400, 2.7, '2031-01-01', '2031-01-28', 'V'], [1931085000, null, '2031-02-01', '2031-02-28', 'V']] })
    const r = rowOf(view({ bySymbol: { USCPIYOY: cpi } }), 'cpi')
    expect(r.state).toBe('ok')
    expect(r.latest).toMatchObject({ value: null, text: null, period: 'Feb 2031' })
    expect(r.change).toBeNull()
    expect(valueText(null, { units: { fmt: 'pct1' } })).toBeNull()
    expect(changeOf(null, 2, {})).toBeNull()
    expect(changeOf(2, undefined, {})).toBeNull()
    expect(changeOf(5, 0, { units: { display: 'index', fmt: 'num1' } })).toBeNull()
  })

  it('a series the server does not serve, one with nothing published, and one missing from the answer', () => {
    const v = view({ bySymbol: { USUNRATE: { symbol: 'USUNRATE', state: 'not_found' }, USJOLTSO: null } })
    expect(rowOf(v, 'unemployment')).toMatchObject({ state: 'not_found', words: 'Not among the economic series this server publishes.' })
    expect(rowOf(v, 'openings')).toMatchObject({ state: 'not_found' })
    const nh = rowOf(v, 'new_homes')
    expect(nh).toMatchObject({ state: 'no_data', words: 'No reading published here yet.' })
    expect(nh.next).toMatchObject({ state: 'ok', date: '2031-03-25' })
    expect(rowOf(v, 'ppi').alt).toBeNull()                     // its month-over-month has nothing published
    expect(v.held).toBe(18)
    expect(view().held).toBe(20)
  })

  it('points: a null value is kept, a broken point dropped, the order is by release time', () => {
    expect(pointsOf([[3, null, '2031-02-01', '2031-02-28'], [1, 2, '2031-01-01', '2031-01-28'], ['x', 1], [2, 'NaN']]))
      .toEqual([{ t: 1, v: 2, ps: '2031-01-01', pe: '2031-01-28' }, { t: 3, v: null, ps: '2031-02-01', pe: '2031-02-28' }])
    expect(pointsOf([[1, 2, '2031-01-01']], ['v', 't'])).toEqual([{ t: 2, v: 1, ps: null, pe: null }])   // read by column name
    expect(pointsOf([[1, 2]], ['v'])).toEqual([])                                                        // no time column
  })
})

describe('the next release is the calendar\'s date', () => {
  it('as the calendar states it, never today, never an invented time', () => {
    expect(nextReleaseOf({ next_release: { date: '2031-04-10', time: '08:30', tz: 'America/New_York', precision: 'exact' } }, ECON_TODAY))
      .toMatchObject({ state: 'ok', date: '2031-04-10', text: 'Apr 10, 8:30 AM ET', days: 21 })
    expect(nextReleaseOf({ next_release: { date: '2031-03-24', time: '10:00', precision: 'time_configured' } }, ECON_TODAY).text)
      .toBe('Mar 24, 10:00 AM ET (typical)')
    expect(nextReleaseOf({ next_release: { date: '2031-03-25', time: '09:00', precision: 'rule' } }, ECON_TODAY).text)
      .toBe('Mar 25, ~9:00 AM ET (est.)')
    expect(nextReleaseOf({ next_release: { date: '2032-01-09', time: null, precision: 'date_only' } }, ECON_TODAY).text).toBe('Jan 9, 2032')
    for (const c of [null, {}, { next_release: null }, { next_release: { date: null, precision: 'unknown' } },
      { next_release: { date: '2031-04-01', precision: 'unknown' } }]) {
      expect(nextReleaseOf(c, ECON_TODAY)).toEqual({ state: 'not_held', text: 'Next release date not held' })
    }
    expect(nextReleaseOf({ next_release: { date: '2031-03-18', time: '08:30', precision: 'exact' } }, ECON_TODAY))
      .toMatchObject({ state: 'passed', text: 'Was due Mar 18; not confirmed yet' })
  })

  it('a release due and not in, or a source that failed, is said; current or unscheduled says nothing', () => {
    expect(releaseNote({ state: 'CHECKING' })).toBe('Due now; the server is checking for it')
    expect(releaseNote({ state: 'DELAYED' })).toBe('Delayed: the newest release has not arrived')
    expect(releaseNote({ state: 'SOURCE_UNAVAILABLE' })).toBe('The source could not be read; last good value shown')
    expect(releaseNote({ state: 'CURRENT' })).toBeNull()
    expect(releaseNote({ state: 'NO_EXPECTATION' })).toBeNull()
    expect(releaseNote(null)).toBeNull()
  })
})

describe('the releases ahead', () => {
  it('today through the same weekday next week, soonest first, grouped by release time; daily rates left out', () => {
    const ahead = view().ahead
    expect(ahead.map((g) => [g.when, g.labels])).toEqual([
      ['Tue Mar 25, 9:00 AM ET (est.)', ['House prices (FHFA)']],
      ['Tue Mar 25, 10:00 AM ET', ['New home sales']],
      ['Wed Mar 26, 8:30 AM ET', ['PCE prices', 'Core PCE prices', 'Personal income', 'Personal spending']],
      ['Thu Mar 27, 8:30 AM ET', ['Initial jobless claims', 'Real GDP']],
    ])
    expect(ahead.flatMap((g) => g.labels)).not.toContain('PPI')                   // eight days away
    expect(ahead.flatMap((g) => g.labels)).not.toContain('Effective fed funds rate') // daily
    expect(ahead.flatMap((g) => g.labels)).not.toContain('Broad dollar index (Fed)') // daily figures (released weekly, Mar 24: in range)
  })

  it('a release later today says today; no date held lists nothing', () => {
    const rows = [
      { label: 'A', frequency: 'M', next: { state: 'ok', date: ECON_TODAY, time: '14:00', precision: 'exact' } },
      { label: 'B', frequency: 'M', next: { state: 'not_held' } },
      { label: 'C', frequency: 'M', next: { state: 'ok', date: '2031-03-21', time: null, precision: 'date_only' } },
    ]
    expect(releasesAhead(rows, ECON_TODAY).map((g) => g.when)).toEqual(['Today, 2:00 PM ET', 'Fri Mar 21'])
    expect(releasesAhead(rows, null)).toEqual([])
    expect(weekdayOf('2031-03-20')).toBe('Thu')
    expect(daysBetween('2031-03-20', '2031-03-27')).toBe(7)
  })
})

describe('the credit lines', () => {
  it('once per source shown, in board order, with the blanks filled', () => {
    const credits = view().credits
    expect(credits.map((c) => c.key)).toEqual(['bls', 'bea', 'dol', 'fed_board', 'census', 'fhfa', 'nyfed'])
    const by = Object.fromEntries(credits.map((c) => [c.key, c.text]))
    expect(by.bls).toBe('Invented BLS line, read on 2031-03-20.')
    expect(by.nyfed).toBe('The Effective Federal Funds Rate is invented for UCT Intelligence.')
    expect(credits.find((c) => c.key === 'bls').derived).toBe(true)
    expect(credits.find((c) => c.key === 'dol').derived).toBe(false)
  })

  it('a source not shown is not credited; a source whose line did not come still gets its name; no retrieval day is said', () => {
    const v = view({ bySymbol: { USEFFR: { symbol: 'USEFFR', state: 'not_found' } }, over: { attributions: { ...ECON_ATTRIBUTIONS, fhfa: undefined } } })
    expect(v.credits.map((c) => c.key)).not.toContain('nyfed')
    expect(v.credits.find((c) => c.key === 'fhfa').text).toBe('Source: FHFA.')
    const noDate = creditLines([{ state: 'ok', meta: { name: 'X', source: { attribution_key: 'bls' } }, retrievedAt: null }], ECON_ATTRIBUTIONS, { today: ECON_TODAY })
    expect(noDate[0].text).toBe('Invented BLS line, read on a date not held here.')
  })

  it('a line that asks for the publication date gets the newest release day of that source\'s figures shown, with its year', () => {
    const atts = { eia: { agency: 'U.S. Energy Information Administration', text: 'Invented EIA line ({publication_date}).' } }
    const meta = (name) => ({ name, source: { agency: 'U.S. Energy Information Administration', attribution_key: 'eia' } })
    // released Tue Mar 18 and Wed Mar 19, 2031 (New York): the newer one is the publication date
    const rows = [
      { state: 'ok', meta: meta('A'), retrievedAt: null, latest: { t: 1931606100 } },
      { state: 'ok', meta: meta('B'), retrievedAt: null, latest: { t: 1931692500 } },
      { state: 'not_found', meta: meta('C'), latest: { t: 1999999999 } },
    ]
    expect(creditLines(rows, atts, { today: ECON_TODAY })[0].text).toBe('Invented EIA line (Mar 19, 2031).')
    expect(creditLines([{ ...rows[0], latest: { t: null } }], atts, { today: ECON_TODAY })[0].text).toBe('Invented EIA line (a date not held here).')
    // a line without the blank is untouched
    expect(creditLines(rows, { eia: { text: 'No blank here.' } }, { today: ECON_TODAY })[0].text).toBe('No blank here.')
  })
})

describe('the answer as a whole', () => {
  it('the newest release time, and an answer that is not the route\'s shape', () => {
    expect(view().newestT).toBe(1931776200)
    for (const b of [null, [], { series: 'x' }, { items: [] }, 'text']) expect(economyRead(b, { today: ECON_TODAY }).state).toBe('bad_shape')
  })

  it('a failed read in words: signed out, a plan without chart data, switched off, a timeout, anything else', () => {
    expect(econFailure({ status: 401 })).toMatchObject({ kind: 'error', state: 'signed_out', retry: true })
    expect(econFailure({ status: 403 })).toMatchObject({ kind: 'locked', state: 'plan', title: 'The economic data needs a paid plan.', retry: false })
    expect(econFailure({ status: 402 }).state).toBe('plan')
    const off = econFailure({ status: 404 })
    expect(off).toMatchObject({ kind: 'locked', state: 'off', title: 'The economic data is switched off for this server.', retry: false })
    expect(off.hint).toContain('Nothing is wrong with your account.')
    expect(econFailure({ timedOut: true })).toMatchObject({ state: 'timeout', retry: true })
    expect(econFailure({ status: 500 })).toMatchObject({ kind: 'error', title: 'The economic data could not be read just now.', retry: true })
    expect(econFailure(null).state).toBe('error')
  })
})
