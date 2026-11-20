// SEASB's pure half. Every number here is invented; the fixtures are the route's real shape
// (api/services/seasonality_board.py: a fund with numbers carries twelve months, a fund without
// carries a status and no months).
import { describe, it, expect } from 'vitest'
import {
  SEASB_CODE, SEASB_NARROW_MONTHS, SEASB_POLL_MS, SEASB_SETTLED_POLL_MS, SEASB_SOURCE, SEASB_URL, SEASB_WHAT, SEAS_MEASURES,
  boardFacts, cellFor, ledeLine, monthLong, monthShort, monthsFrom, narrowMonths, normSeasMeasure, pctText, pollMs,
  seasonalityBoardCommandArgs, seasonalityBoardRead, signOf, sinceYear, upCount, upWords, withoutNote, withoutWords,
} from './seasonalityBoardModel'

const LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** One month as the server sends it. */
const mo = (month, n, median, avg, pctUp, thin = n < 5) => ({ month, label: LABELS[month - 1], n, avg_pct: avg, median_pct: median, pct_up: pctUp, thin })
/** Twelve months, every one `n` years of +0.5 median / +0.7 average / 60% up, with overrides by month number. */
const twelve = (n, over = {}) => LABELS.map((_, i) => over[i + 1] || mo(i + 1, n, 0.5, 0.7, 60))
const fund = (symbol, name, kind, months, from = '1999-01-04') => ({
  symbol, name, kind, status: 'ok', months, covered_from: from, covered_to: '2026-11-19', full_months: 300,
})
const lacking = (symbol, name, kind, status, reason = null) => ({ symbol, name, kind, status, reason })
const board = (funds, over = {}) => ({
  funds, this_month: 11, next_month: 12, et_date: '2026-11-20', min_years: 5, source: 'UCT daily bar store, close to close',
  as_of: '2026-11-20T09:31:00-05:00', data_through: '2026-11-19',
  complete: funds.every((f) => f.status === 'ok'), settled: funds.every((f) => f.status === 'ok' || f.status === 'not_held'), ...over,
})

const SPY = fund('SPY', 'S&P 500', 'index', twelve(26, { 11: mo(11, 26, 9.9, 9.1, 96) }))            // an index fund is never a "sector fund" fact
const XLK = fund('XLK', 'Technology', 'sector', twelve(26, { 11: mo(11, 26, 2.14, 1.62, 73), 12: mo(12, 26, -0.44, 0.31, 46) }))
const XLE = fund('XLE', 'Energy', 'sector', twelve(26, { 11: mo(11, 26, -1.36, -0.2, 35) }))
const XLU = fund('XLU', 'Utilities', 'sector', twelve(26, { 11: mo(11, 26, 0.6, 0.9, 62) }))
const XLC = fund('XLC', 'Communication Services', 'sector', twelve(3, { 11: mo(11, 3, 6.5, 6.9, 100) }), '2018-06-19')   // thin everywhere
const FOUR = [SPY, XLK, XLE, XLU]

describe('the names', () => {
  it('the code, the route, the source and the pace', () => {
    expect(SEASB_CODE).toBe('SEASB')
    expect(SEASB_URL).toBe('/api/research/seasonality-board')
    expect(SEASB_WHAT).toBe('The seasonality board')
    expect(SEASB_SOURCE).toBe('UCT daily bar store')
    expect(SEASB_POLL_MS).toBe(30000)
    expect(SEASB_SETTLED_POLL_MS).toBe(1800000)
    expect(SEASB_NARROW_MONTHS).toBe(3)
  })

  it('the measures: the median is the bare command, the average carries AVG', () => {
    expect(Object.keys(SEAS_MEASURES)).toEqual(['median', 'average'])
    expect(SEAS_MEASURES.median).toMatchObject({ token: null, field: 'median_pct', word: 'median' })
    expect(SEAS_MEASURES.average).toMatchObject({ token: 'AVG', field: 'avg_pct', word: 'average' })
    expect(normSeasMeasure('average')).toBe('average')
    for (const v of [undefined, null, '', 'mean', 'toString']) expect(normSeasMeasure(v), String(v)).toBe('median')
    expect(seasonalityBoardCommandArgs({ measure: 'average' })).toEqual(['AVG'])
    expect(seasonalityBoardCommandArgs({ measure: 'median' })).toEqual([])
    expect(seasonalityBoardCommandArgs()).toEqual([])
  })
})

describe('months', () => {
  it('run from this month forward, and wrap the year end', () => {
    expect(monthsFrom(11)).toEqual([11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(monthsFrom(1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(monthsFrom(12)).toEqual([12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    for (const bad of [0, 13, 2.5, null, undefined, '11']) expect(monthsFrom(bad), String(bad)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('a narrow panel keeps this month, the next and the one after, across a year end too', () => {
    expect(narrowMonths(6)).toEqual([6, 7, 8])
    expect(narrowMonths(11)).toEqual([11, 12, 1])
    expect(narrowMonths(12)).toEqual([12, 1, 2])
    expect(narrowMonths(10)).toEqual([10, 11, 12])
  })

  it('names', () => {
    expect([monthShort(1), monthShort(11), monthShort(12)]).toEqual(['Jan', 'Nov', 'Dec'])
    expect([monthLong(1), monthLong(11)]).toEqual(['January', 'November'])
    expect([monthShort(0), monthLong(13), monthShort(null)]).toEqual([null, null, null])
  })
})

describe('figures', () => {
  it('a signed percent with one decimal; zero has no sign; a missing figure is n/a, never 0', () => {
    expect(pctText(2.14)).toBe('+2.1%')
    expect(pctText(-0.44)).toBe('-0.4%')
    expect(pctText(12.34)).toBe('+12.3%')
    expect(pctText(0)).toBe('0.0%')
    expect(pctText(0.04)).toBe('0.0%')
    expect(pctText(-0.04)).toBe('0.0%')
    for (const missing of [null, undefined, NaN, Infinity, '2.1', {}]) expect(pctText(missing), String(missing)).toBe('n/a')
  })

  it('the sign is the sign of what is shown', () => {
    expect(signOf(2.14)).toBe('up')
    expect(signOf(-1.36)).toBe('down')
    expect(signOf(0)).toBe('flat')
    expect(signOf(0.04)).toBe('flat')         // shown as 0.0%: never green
    expect(signOf(-0.04)).toBe('flat')
    expect(signOf(null)).toBeNull()
    expect(signOf('3')).toBeNull()
  })

  it('the up count is recovered only when exactly one count rounds to the percent', () => {
    expect(upCount(70, 10)).toBe(7)
    expect(upCount(73, 26)).toBe(19)           // 19 / 26 = 73.08
    expect(upCount(100, 5)).toBe(5)
    expect(upCount(0, 7)).toBe(0)
    // halves, which the server rounds to the even whole number: 1/8 = 12.5 -> 12, 3/8 = 37.5 -> 38, 5/8 = 62.5 -> 62
    expect([upCount(12, 8), upCount(38, 8), upCount(62, 8), upCount(88, 8)]).toEqual([1, 3, 5, 7])
    // 99, 100 and 101 of 200 all round to 50
    expect(upCount(50, 200)).toBeNull()
    // a percent no count of ten years gives
    expect(upCount(71, 10)).toBeNull()
    for (const [p, n] of [[null, 5], [70, 0], [70, -3], [70, 2.5], ['70', 10], [NaN, 10]]) expect(upCount(p, n), `${p}/${n}`).toBeNull()
  })

  it('the line under a figure', () => {
    expect(upWords(70, 10)).toBe('7 of 10 up')
    expect(upWords(73, 26)).toBe('19 of 26 up')
    expect(upWords(50, 200)).toBe('50% up, 200 yrs')
    expect(upWords(71, 10)).toBe('71% up, 10 yrs')
    expect(upWords(100, 1)).toBe('1 of 1 up')
    expect(upWords(null, 4)).toBe('4 yrs')
    expect(upWords(70, 0)).toBeNull()
  })

  it('since', () => {
    expect(sinceYear('1999-01-04')).toBe('1999')
    expect(sinceYear('2018-06-19T00:00:00')).toBe('2018')
    for (const bad of [null, '', '99-01-04', 19990104]) expect(sinceYear(bad), String(bad)).toBeNull()
  })
})

describe('one cell', () => {
  it('a month with enough years: the median, its sign, and how often it rose', () => {
    const up = cellFor(mo(11, 26, 2.14, 1.62, 73), 'median', 5)
    expect(up).toMatchObject({ month: 11, label: 'Nov', n: 26, value: 2.14, thin: false, tone: 'up', text: '+2.1%', sub: '19 of 26 up' })
    expect(up.title).toBe('November: median +2.1%, 19 of 26 up')
    const down = cellFor(mo(12, 26, -0.44, 0.31, 46), 'median', 5)
    expect(down).toMatchObject({ tone: 'down', text: '-0.4%', sub: '12 of 26 up' })
    expect(cellFor(mo(3, 10, 0.02, 0.4, 50), 'median', 5)).toMatchObject({ tone: 'flat', text: '0.0%', sub: '5 of 10 up' })
  })

  it('the average is the other field of the same month, and can have the other sign', () => {
    const dec = mo(12, 26, -0.44, 0.31, 46)
    expect(cellFor(dec, 'average', 5)).toMatchObject({ tone: 'up', text: '+0.3%', sub: '12 of 26 up' })
    expect(cellFor(dec, 'average', 5).title).toBe('December: average +0.3%, 12 of 26 up')
    expect(cellFor(dec, 'nonsense', 5)).toMatchObject({ tone: 'down', text: '-0.4%' })      // an unknown measure is the median
  })

  it('a thin month is dimmed with its count and never coloured, whatever its sign', () => {
    const thin = cellFor(mo(11, 3, 6.5, 6.9, 100), 'median', 5)
    expect(thin).toMatchObject({ tone: 'thin', thin: true, text: '+6.5%', sub: '3 yrs', n: 3 })
    expect(thin.title).toBe('November: median +6.5% over 3 years. Fewer than 5 years: too few to lean on.')
    expect(cellFor(mo(2, 1, -4.0, -4.0, 0), 'median', 5)).toMatchObject({ tone: 'thin', text: '-4.0%', sub: '1 yr' })
    // thin by the count even when the flag did not come, and by the flag even when the count would pass
    expect(cellFor({ month: 2, n: 4, median_pct: 1.2, avg_pct: 1.0, pct_up: 75 }, 'median', 5).tone).toBe('thin')
    expect(cellFor(mo(2, 9, 1.2, 1.0, 78, true), 'median', 5).tone).toBe('thin')
    expect(cellFor(mo(2, 5, 1.2, 1.0, 80), 'median', 5).tone).toBe('up')                    // exactly min_years is enough
  })

  it('a month nobody counted is n/a, never a zero', () => {
    const none = cellFor({ month: 7, label: 'Jul', n: 0, avg_pct: null, median_pct: null, pct_up: null, thin: true }, 'median', 5)
    expect(none).toMatchObject({ tone: 'none', text: 'n/a', sub: 'no full month', value: null, n: 0 })
    expect(none.title).toBe('July: no full month on record')
    // a count with no figure, and a figure with no count, are both n/a
    expect(cellFor({ month: 7, n: 6, median_pct: null, avg_pct: 1 }, 'median', 5)).toMatchObject({ tone: 'none', text: 'n/a', sub: '6 yrs' })
    expect(cellFor({ month: 7, n: 0, median_pct: 3.3 }, 'median', 5)).toMatchObject({ tone: 'none', text: 'n/a' })
    expect(cellFor(undefined, 'median', 5)).toMatchObject({ tone: 'none', text: 'n/a', month: null })
  })
})

describe('the board', () => {
  it('an answer that is not a board is failed, never an empty board', () => {
    for (const bad of [null, undefined, [], 'x', {}, { funds: 'x', this_month: 11 }, { funds: [], this_month: 0 }, { funds: [] }]) {
      expect(seasonalityBoardRead(bad, 'median').state, JSON.stringify(bad)).toBe('failed')
    }
  })

  it('every fund with numbers: rows in the server order, columns from this month forward', () => {
    const view = seasonalityBoardRead(board(FOUR), 'median')
    expect(view.state).toBe('ready')
    expect(view).toMatchObject({ thisMonth: 11, nextMonth: 12, minYears: 5, settled: true, complete: true, dataThrough: '2026-11-19', funds: 4, pending: 0 })
    expect(view.rows.map((r) => r.symbol)).toEqual(['SPY', 'XLK', 'XLE', 'XLU'])
    expect(view.rows.map((r) => r.kind)).toEqual(['index', 'sector', 'sector', 'sector'])
    expect(view.rows[1]).toMatchObject({ name: 'Technology', since: '1999', fullMonths: 300 })
    expect(view.months.map((m) => m.label)).toEqual(['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'])
    expect(view.months.map((m) => m.mark)).toEqual(['now', 'next', null, null, null, null, null, null, null, null, null, null])
    expect(view.months.filter((m) => m.narrow).map((m) => m.month)).toEqual([11, 12, 1])
    expect(view.months[0].long).toBe('November')
    // each cell sits under its own month
    const xlk = view.rows[1].cells
    expect(xlk.map((c) => c.month)).toEqual([11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(xlk[0]).toMatchObject({ text: '+2.1%', tone: 'up', sub: '19 of 26 up' })
    expect(xlk[1]).toMatchObject({ text: '-0.4%', tone: 'down' })
    expect(xlk[2]).toMatchObject({ month: 1, text: '+0.5%' })
    expect(view.without).toEqual([])
  })

  it('the measure changes the figure and nothing else', () => {
    const med = seasonalityBoardRead(board(FOUR), 'median')
    const avg = seasonalityBoardRead(board(FOUR), 'average')
    expect(avg.measure).toBe('average')
    expect(avg.rows[1].cells[0]).toMatchObject({ text: '+1.6%', sub: '19 of 26 up' })
    expect(avg.rows[1].cells[1]).toMatchObject({ text: '+0.3%', tone: 'up' })
    expect(avg.rows.map((r) => r.symbol)).toEqual(med.rows.map((r) => r.symbol))
    expect(avg.months).toEqual(med.months)
  })

  it('December: the columns start at December and next is January', () => {
    const view = seasonalityBoardRead(board(FOUR, { this_month: 12, next_month: 1 }), 'median')
    expect(view.months.slice(0, 4).map((m) => [m.label, m.mark, m.narrow])).toEqual([['Dec', 'now', true], ['Jan', 'next', true], ['Feb', null, true], ['Mar', null, false]])
    expect(view.rows[1].cells[0]).toMatchObject({ month: 12, text: '-0.4%' })
    // a board that did not say which month is next still gets it right
    expect(seasonalityBoardRead(board(FOUR, { this_month: 12, next_month: undefined }), 'median').nextMonth).toBe(1)
  })

  it('a fund with a short record keeps its own start and its thin months', () => {
    const view = seasonalityBoardRead(board([XLK, XLC]), 'median')
    expect(view.rows[1]).toMatchObject({ symbol: 'XLC', since: '2018' })
    expect(view.rows[1].cells.every((c) => c.tone === 'thin')).toBe(true)
    expect(view.rows[0].cells.some((c) => c.tone === 'thin')).toBe(false)
  })

  it('funds without numbers are named with why, never drawn as rows', () => {
    const view = seasonalityBoardRead(board([
      XLK,
      lacking('XLC', 'Communication Services', 'sector', 'pending'),
      lacking('XLRE', 'Real Estate', 'sector', 'not_held'),
      lacking('XLB', 'Materials', 'sector', 'unavailable', 'too_short'),
      lacking('XLP', 'Consumer Staples', 'sector', 'unavailable', 'RuntimeError'),
      { symbol: 'XLV', name: 'Healthcare', kind: 'sector', status: 'ok', months: [] },          // "ok" with no months is not ok
      { name: 'no symbol', status: 'pending' },                                                  // not a fund at all
    ]), 'median')
    expect(view.state).toBe('partial')
    expect(view.rows.map((r) => r.symbol)).toEqual(['XLK'])
    expect(view.without.map((w) => [w.symbol, w.status])).toEqual([
      ['XLC', 'pending'], ['XLRE', 'not_held'], ['XLB', 'unavailable'], ['XLP', 'unavailable'], ['XLV', 'unavailable']])
    expect(view.without.map((w) => w.text)).toEqual([
      'XLC: the full history is still being read; this fills in on its own.',
      'XLRE: we hold no daily bars for it.',
      'XLB: we hold less than one full calendar month of daily bars for it.',
      'XLP: its daily bars could not be read just now; it is asked again on its own.',
      'XLV: its daily bars could not be read just now; it is asked again on its own.',
    ])
    expect(view.without[3].reason).toBe('RuntimeError')                // kept for support, not in the sentence
    expect(view.without[3].text).not.toContain('RuntimeError')
    expect(view).toMatchObject({ funds: 6, pending: 1, complete: false, settled: false })
  })

  it('no fund with numbers: waiting while something is still being read, none when nothing is', () => {
    const cold = seasonalityBoardRead(board(['SPY', 'QQQ', 'XLK'].map((s) => lacking(s, s, 'index', 'pending')), { data_through: null }), 'median')
    expect(cold).toMatchObject({ state: 'waiting', pending: 3, funds: 3, settled: false, dataThrough: null })
    expect(cold.rows).toEqual([])
    expect(cold.months).toHaveLength(12)
    const gone = seasonalityBoardRead(board([lacking('SPY', 'S&P 500', 'index', 'not_held')]), 'median')
    expect(gone).toMatchObject({ state: 'none', settled: true, complete: false })
    // the server says complete only when every fund has numbers; a board that says it with a fund missing is not believed
    expect(seasonalityBoardRead(board([XLK, lacking('XLC', 'x', 'sector', 'pending')], { complete: true }), 'median').complete).toBe(false)
  })

  it('the words for a fund without numbers', () => {
    expect(withoutWords({ symbol: 'XLC', status: 'pending' })).toBe('XLC: the full history is still being read; this fills in on its own.')
    expect(withoutWords({ symbol: 'XLC', status: 'unavailable', reason: 'transient' })).toBe('XLC: its daily bars could not be read just now; it is asked again on its own.')
    expect(withoutWords({ status: 'not_held' })).toBe('This fund: we hold no daily bars for it.')
  })
})

describe('the pace', () => {
  it('30 seconds while a fund is waiting, slow once none is', () => {
    expect(pollMs(board([XLK, lacking('XLC', 'x', 'sector', 'pending')]))).toBe(30000)
    expect(pollMs(board([XLK, lacking('XLC', 'x', 'sector', 'unavailable', 'transient')], { settled: false }))).toBe(30000)
    expect(pollMs(board(FOUR))).toBe(1800000)
    expect(pollMs(board([XLK, lacking('XLRE', 'x', 'sector', 'not_held')]))).toBe(1800000)      // not held does not heal: no fast re-ask
    // a board from a server that does not send `settled` falls back to `complete`
    expect(pollMs(board(FOUR, { settled: undefined }))).toBe(1800000)
    expect(pollMs(board([XLK, lacking('XLC', 'x', 'sector', 'pending')], { settled: undefined }))).toBe(30000)
    for (const bad of [null, undefined, {}, 'x']) expect(pollMs(bad), String(bad)).toBe(30000)
  })
})

describe('the note under the grid', () => {
  it('one line per fund without numbers', () => {
    const note = withoutNote(seasonalityBoardRead(board([XLK, lacking('XLC', 'x', 'sector', 'pending'), lacking('XLRE', 'x', 'sector', 'not_held')]), 'median'))
    expect(note.one).toBeNull()
    expect(note.lines).toEqual([
      { symbol: 'XLC', text: 'XLC: the full history is still being read; this fills in on its own.', status: 'pending', reason: null },
      { symbol: 'XLRE', text: 'XLRE: we hold no daily bars for it.', status: 'not_held', reason: null },
    ])
  })

  it('every fund waiting for the same thing is one sentence', () => {
    const cold = seasonalityBoardRead(board(['SPY', 'QQQ', 'XLK'].map((s) => lacking(s, s, 'index', 'pending'))), 'median')
    expect(withoutNote(cold)).toEqual({ one: 'All 3 funds: the full history is still being read; this fills in on its own.', lines: [] })
    // a mix is listed fund by fund, and so is a single fund
    const mixed = seasonalityBoardRead(board([lacking('SPY', 'x', 'index', 'pending'), lacking('QQQ', 'x', 'index', 'not_held')]), 'median')
    expect(withoutNote(mixed).one).toBeNull()
    expect(withoutNote(mixed).lines).toHaveLength(2)
    expect(withoutNote(seasonalityBoardRead(board([lacking('SPY', 'x', 'index', 'pending')]), 'median')).lines).toHaveLength(1)
  })

  it('nothing to say when every fund has numbers', () => {
    expect(withoutNote(seasonalityBoardRead(board(FOUR), 'median'))).toBeNull()
    expect(withoutNote(null)).toBeNull()
  })
})

describe('the two facts', () => {
  it('the sector fund with the highest median this month and the one with the lowest, each with its count', () => {
    const facts = boardFacts(board(FOUR))
    expect(facts.best).toBe('Best sector fund in November since 1999: Technology (XLK), median +2.1%, up 19 of 26 years.')
    expect(facts.worst).toBe('Weakest sector fund in November since 1999: Energy (XLE), median -1.4%, up 9 of 26 years.')
    expect(facts.leftOut).toBeNull()
    expect(facts.why).toBeNull()
    // the index fund has the highest November of all and is not a sector fund
    expect(facts.best).not.toContain('SPY')
  })

  it('a thin month is never the best or the weakest, and the fund left out is named', () => {
    const facts = boardFacts(board([...FOUR, XLC, lacking('XLRE', 'Real Estate', 'sector', 'pending')]))
    expect(facts.best).toContain('Technology (XLK)')                     // XLC's +6.5% over 3 years does not win
    expect(facts.best).not.toContain('XLC')
    expect(facts.leftOut).toBe('Not counted in those two: XLC (3 years), XLRE (no numbers yet).')
  })

  it('a fund with years but none of this month is left out as none on record', () => {
    const noNov = fund('XLB', 'Materials', 'sector', twelve(26, { 11: { month: 11, label: 'Nov', n: 0, avg_pct: null, median_pct: null, pct_up: null, thin: true } }))
    expect(boardFacts(board([...FOUR, noNov])).leftOut).toBe('Not counted in those two: XLB (none on record).')
  })

  it('refused with fewer than two sector funds that have the years, and says why', () => {
    const one = boardFacts(board([SPY, XLK, XLC]))
    expect(one).toEqual({ best: null, worst: null, leftOut: null, why: 'Too few sector funds have 5 or more Novembers on record to name a best or a weakest.' })
    expect(boardFacts(board([SPY])).why).toBeNull()                      // no sector fund at all: nothing to say
    expect(boardFacts(board([lacking('XLK', 'Technology', 'sector', 'pending'), lacking('XLE', 'Energy', 'sector', 'pending')])).best).toBeNull()
    expect(boardFacts(null)).toEqual({ best: null, worst: null, leftOut: null, why: null })
  })

  it('exactly min_years is enough; one fewer is not', () => {
    const five = fund('XLB', 'Materials', 'sector', twelve(26, { 11: mo(11, 5, 4.0, 4.0, 80) }))
    const four = fund('XLP', 'Consumer Staples', 'sector', twelve(26, { 11: mo(11, 4, 8.0, 8.0, 100) }))
    const facts = boardFacts(board([XLK, XLE, five, four]))
    expect(facts.best).toBe('Best sector fund in November since 1999: Materials (XLB), median +4.0%, up 4 of 5 years.')
    expect(facts.leftOut).toBe('Not counted in those two: XLP (4 years).')
  })

  it('they are always the median, and a tie keeps the first fund listed', () => {
    // XLU's average (+0.9) is above XLK's (+1.62)? no: the facts never read the average at all
    const avgHigh = fund('XLI', 'Industrials', 'sector', twelve(26, { 11: mo(11, 26, 0.1, 9.9, 55) }))
    expect(boardFacts(board([XLK, XLE, avgHigh])).best).toContain('Technology (XLK)')
    const twin = fund('XLY', 'Consumer Discretionary', 'sector', twelve(26, { 11: mo(11, 26, 2.14, 1.0, 58) }))
    expect(boardFacts(board([XLK, twin, XLE])).best).toContain('Technology (XLK)')
    expect(boardFacts(board([twin, XLK, XLE])).best).toContain('Consumer Discretionary (XLY)')
  })

  it('every counted fund on one median: no best and no weakest', () => {
    const a = fund('XLI', 'Industrials', 'sector', twelve(26))
    const b = fund('XLB', 'Materials', 'sector', twelve(26))
    expect(boardFacts(board([a, b]))).toEqual({ best: null, worst: null, leftOut: null,
      why: 'The sector funds with 5 or more Novembers on record all share one median, so there is no best or weakest.' })
  })

  it('a count that cannot be recovered is said as a percent', () => {
    const long = fund('XLI', 'Industrials', 'sector', twelve(26, { 11: mo(11, 200, 3.3, 3.0, 50) }))
    expect(boardFacts(board([long, XLE])).best).toBe('Best sector fund in November since 1999: Industrials (XLI), median +3.3%, up 50% of 200 years.')
  })

  it('the month in the sentence is the board\'s own', () => {
    const dec = boardFacts(board(FOUR, { this_month: 12, next_month: 1 }))
    expect(dec.best).toContain('in December since 1999')
    expect(dec.worst).toBe('Weakest sector fund in December since 1999: Technology (XLK), median -0.4%, up 12 of 26 years.')
  })

  it('no sentence forecasts', () => {
    const facts = boardFacts(board([...FOUR, XLC]))
    for (const line of [facts.best, facts.worst, facts.leftOut]) {
      expect(line).not.toMatch(/will|expect|should|likely|tends|forecast|predict|—/i)
    }
  })
})

describe('the line above the grid', () => {
  it('what it is, where it is from, and which month is this month', () => {
    expect(ledeLine(seasonalityBoardRead(board(FOUR), 'median'))).toBe(
      'How each fund has done in each calendar month, close to close, from the daily bars we hold. This month is November; the months run from it forward.')
    expect(ledeLine(null)).toBe('How each fund has done in each calendar month, close to close, from the daily bars we hold.')
  })
})
