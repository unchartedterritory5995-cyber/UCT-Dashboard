// TSRC, the pure half. Rails:
//   * a query is checked before it is sent (the server answers 422 under 2 characters), and the
//     words written into the command read back as the same query;
//   * an excerpt is split into text and marked runs, and nothing else in it is treated as markup;
//   * the search answer: one row per call, the cut reported, and a bad query, a query with no
//     words, a failed search and not-this-route are separate states, none of them "no call said it";
//   * the trend answer: the share is the percent the server sends, the months are the index's
//     span, and rising / fading is worked out only from months with enough calls.
// The fixtures are the routes' real shapes (api/services/transcript_index.py search / trend).
import { describe, it, expect } from 'vitest'
import {
  CALL_SEARCH_CODE, MAX_QUERY, MIN_MONTH_CALLS, MIN_QUERY, SEARCH_LIMIT, TREND_MONTHS, TREND_WORDS, callDay, callQuery,
  callSearchCommandArgs, callSearchUrl, callTrendUrl, monthLabel, parseCallQuery, parseSnippet, quarterText, searchRead, trendRead,
  trendVerdict,
} from './callSearchModel'

const SEARCH = {
  query: 'tariff',
  match: '"tariff"',
  total: 3,
  hits: [
    { symbol: 'AAA', year: 2026, quarter: 3, date: '2026-11-05 17:00:00', snippet: 'we expect the <mark>tariff</mark> impact to be about … offset by <mark>tariffs</mark> relief', score: 4.211 },
    { symbol: 'bbb', year: 2026, quarter: 2, date: '2026-08-12', snippet: 'no change to our <mark>tariff</mark> assumptions', score: 2.5 },
    { symbol: 'CCC', year: 2027, quarter: 1, date: '', snippet: '<mark>Tariff</mark> costs were', score: 1.1 },
  ],
}
const month = (m, calls, mentions) => ({ month: m, calls, mentions, pct: calls ? Math.round((mentions * 1000) / calls) / 10 : null })
const TREND = { query: 'tariff', match: '"tariff"', months: [month('2026-08', 400, 40), month('2026-09', 60, 9), month('2026-10', 500, 75), month('2026-11', 300, 90)], total: 214 }

describe('TSRC query', () => {
  it('the code, the limits and the two routes', () => {
    expect(CALL_SEARCH_CODE).toBe('TSRC')
    expect([MIN_QUERY, MAX_QUERY, SEARCH_LIMIT, TREND_MONTHS]).toEqual([2, 120, 40, 12])
    expect(callSearchUrl('pricing power')).toBe('/api/earnings/transcript-search?q=pricing%20power&limit=40')
    expect(callTrendUrl('"pricing power"')).toBe('/api/earnings/transcript-trend?q=%22pricing%20power%22&months=12')
    expect(callSearchUrl('AT&T')).toBe('/api/earnings/transcript-search?q=AT%26T&limit=40')
  })

  it('checks a query before it is sent', () => {
    expect(callQuery('  pricing   power ')).toEqual({ ok: true, q: 'pricing power' })
    expect(callQuery('AI')).toEqual({ ok: true, q: 'AI' })
    expect(callQuery('"pricing power"')).toEqual({ ok: true, q: '"pricing power"' })
    expect(callQuery('')).toMatchObject({ ok: false, problem: 'empty' })
    expect(callQuery(null)).toMatchObject({ ok: false, problem: 'empty' })
    expect(callQuery('   ')).toMatchObject({ ok: false, problem: 'empty' })
    // the server answers 422 under two characters
    expect(callQuery('a')).toEqual({ ok: false, problem: 'short', message: 'Type at least 2 characters.' })
    expect(callQuery('x'.repeat(MAX_QUERY + 1))).toMatchObject({ ok: false, problem: 'long' })
    expect(callQuery('x'.repeat(MAX_QUERY)).ok).toBe(true)
    // nothing the index could look up
    expect(callQuery('"-*"')).toMatchObject({ ok: false, problem: 'no-words' })
    expect(parseCallQuery(' tariff ')).toBe('tariff')
    expect(parseCallQuery('?')).toBeNull()
    expect(parseCallQuery(undefined)).toBeNull()
  })

  it('the words written into the command read back as the same query', () => {
    expect(callSearchCommandArgs({ q: 'pricing  power' })).toEqual(['pricing', 'power'])
    expect(callSearchCommandArgs({ q: 'x' })).toEqual([])
    expect(callSearchCommandArgs()).toEqual([])
    for (const q of ['tariff', 'pricing power', '"pricing power"', 'AT&T margins']) {
      expect(parseCallQuery(callSearchCommandArgs({ q }).join(' ')), q).toBe(q)
    }
  })
})

describe('TSRC excerpt, dates and labels', () => {
  it('splits an excerpt into text and marked runs', () => {
    expect(parseSnippet('we expect the <mark>tariff</mark> impact')).toEqual([
      { text: 'we expect the ', hit: false }, { text: 'tariff', hit: true }, { text: ' impact', hit: false },
    ])
    expect(parseSnippet('<mark>Tariff</mark> costs <mark>rose</mark>')).toEqual([
      { text: 'Tariff', hit: true }, { text: ' costs ', hit: false }, { text: 'rose', hit: true },
    ])
    expect(parseSnippet('no match here')).toEqual([{ text: 'no match here', hit: false }])
    expect(parseSnippet('')).toEqual([])
    expect(parseSnippet(null)).toEqual([])
    expect(parseSnippet('a <mark></mark> b')).toEqual([{ text: 'a ', hit: false }, { text: ' b', hit: false }])
  })

  it('any other markup in a transcript stays text', () => {
    const parts = parseSnippet('<script>alert(1)</script> <b>big</b> <mark>word</mark> <img src=x onerror=y>')
    expect(parts).toEqual([
      { text: '<script>alert(1)</script> <b>big</b> ', hit: false }, { text: 'word', hit: true }, { text: ' <img src=x onerror=y>', hit: false },
    ])
    // the text is the whole excerpt with only the mark tags taken out: nothing added, nothing dropped
    const raw = 'alpha <mark>beta</mark> gamma … <mark>delta</mark>'
    expect(parseSnippet(raw).map((p) => p.text).join('')).toBe('alpha beta gamma … delta')
  })

  it('reads the calendar date off a provider date, and labels a month and a quarter', () => {
    expect(callDay('2026-11-05 17:00:00')).toBe('2026-11-05')
    expect(callDay('2026-08-12')).toBe('2026-08-12')
    for (const bad of ['', null, undefined, 'Nov 5', '2026-13-01', '11/05/2026']) expect(callDay(bad), String(bad)).toBeNull()
    expect(monthLabel('2026-11')).toBe('Nov 2026')
    expect(monthLabel('2026-01')).toBe('Jan 2026')
    for (const bad of ['2026-13', '2026', '', null, '2026-11-05']) expect(monthLabel(bad), String(bad)).toBeNull()
    expect(quarterText({ quarter: 3, year: 2026 })).toBe('fiscal Q3 2026')
    expect(quarterText({ quarter: null, year: 2026 })).toBe('fiscal 2026')
    expect(quarterText({ quarter: null, year: null })).toBe('Quarter not given')
    expect(quarterText(undefined)).toBe('Quarter not given')
  })
})

describe('TSRC searchRead', () => {
  it('one row per call, best match first as the server sent them', () => {
    const out = searchRead(SEARCH)
    expect(out.state).toBe('ok')
    expect(out.hits.map((h) => [h.key, h.sym, h.year, h.quarter, h.day])).toEqual([
      ['AAA-2026-3', 'AAA', 2026, 3, '2026-11-05'], ['BBB-2026-2', 'BBB', 2026, 2, '2026-08-12'], ['CCC-2027-1', 'CCC', 2027, 1, null],
    ])
    expect(out.hits[0].parts.filter((p) => p.hit).map((p) => p.text)).toEqual(['tariff', 'tariffs'])
    expect(out).toMatchObject({ total: 3, cut: false, notes: [], expanded: [] })
    // no speaker is ever made up: the index does not send one
    expect(Object.keys(out.hits[0]).sort()).toEqual(['day', 'key', 'parts', 'quarter', 'sym', 'year'])
  })

  it('reports a cut, drops a hit with no ticker or no excerpt, and keeps one row for a call sent twice', () => {
    const out = searchRead({ ...SEARCH, total: 212, hits: [...SEARCH.hits, SEARCH.hits[0], { symbol: '', snippet: 'x' }, { symbol: 'DDD', snippet: '' }, null, { symbol: 'EEE', year: 2026, quarter: 9, snippet: 'y' }] })
    expect(out.hits.map((h) => h.sym)).toEqual(['AAA', 'BBB', 'CCC', 'EEE'])
    expect(out.hits[3].quarter).toBeNull()       // not a real quarter: left out, not printed
    expect(out).toMatchObject({ total: 212, cut: true })
    // a total smaller than the rows listed is not believed
    expect(searchRead({ ...SEARCH, total: 0 })).toMatchObject({ total: 3, cut: false })
    expect(searchRead({ ...SEARCH, hits: [], total: 0 })).toMatchObject({ state: 'ok', hits: [], total: 0 })
  })

  it('carries the server\'s own notes and the other words it searched', () => {
    const out = searchRead({ ...SEARCH, operators: true, expanded: { debt: ['borrowings', 'indebtedness'], cash: [] }, notes: ['Exact words were checked.', ' ', null] })
    expect(out.expanded).toEqual([{ word: 'debt', also: ['borrowings', 'indebtedness'] }])
    expect(out.notes).toEqual(['Exact words were checked.'])
  })

  it('a bad query, no words, a failed search and not-this-route are separate states, never "no call said it"', () => {
    expect(searchRead({ query: 'a NEAR', match: null, hits: [], total: 0, error: 'NEAR needs a word on each side.', query_error: true }))
      .toMatchObject({ state: 'bad-query', message: 'NEAR needs a word on each side.', hits: [] })
    expect(searchRead({ query: '"-"', match: null, hits: [], total: 0 }).state).toBe('no-words')
    expect(searchRead({ query: 'x y', match: '"x" AND "y"', hits: [], total: 0, error: 'unsupported search syntax' }).state).toBe('syntax')
    expect(searchRead({ query: 'tariff', hits: [], total: 0, error: 'search unavailable' }).state).toBe('unavailable')
    for (const body of [undefined, null, [], 'x', {}, { total: 3 }, { hits: 'none' }, { detail: 'Earnings intelligence requires a paid plan' }]) {
      expect(searchRead(body).state, JSON.stringify(body)).toBe('failed')
    }
  })
})

describe('TSRC trendRead and the verdict', () => {
  it('the months oldest first, the share as the percent sent, and the span the index covers', () => {
    const out = trendRead({ ...TREND, months: [...TREND.months].reverse() })
    expect(out.state).toBe('ok')
    expect(out.months.map((m) => [m.month, m.label, m.calls, m.mentions, m.share])).toEqual([
      ['2026-08', 'Aug 2026', 400, 40, 10], ['2026-09', 'Sep 2026', 60, 9, 15], ['2026-10', 'Oct 2026', 500, 75, 15], ['2026-11', 'Nov 2026', 300, 90, 30],
    ])
    // `pct` is already a percent on this route: never multiplied again
    expect(out.months.every((m) => m.share <= 100)).toBe(true)
    expect(out).toMatchObject({ callsIndexed: 1260, mentions: 214, firstMonth: '2026-08', lastMonth: '2026-11' })
  })

  it('a month with no calls has no share, a bad row is dropped, and no months is an empty index', () => {
    const out = trendRead({ query: 'q', match: '"q"', months: [{ month: '2026-10', calls: 0, mentions: 0, pct: null }, { month: 'soon', calls: 5 }, null, { month: '2026-11', calls: 10, mentions: 3 }], total: 3 })
    expect(out.months.map((m) => [m.month, m.share])).toEqual([['2026-10', null], ['2026-11', 30]])
    expect(trendRead({ query: 'q', match: '"q"', months: [], total: 0 })).toMatchObject({ state: 'ok', months: [], callsIndexed: 0, firstMonth: null, lastMonth: null })
  })

  it('an error, a query with no words and not-this-route are failed reads, not an empty index', () => {
    for (const body of [undefined, null, [], {}, { months: 'none' }, { query: 'q', months: [], total: 0, error: 'trend unavailable' },
      { query: '"-"', match: null, months: [], total: 0 }]) expect(trendRead(body).state, JSON.stringify(body)).toBe('failed')
  })

  it('rising: the latest month with enough calls against the earlier ones taken together', () => {
    const v = trendVerdict(trendRead(TREND).months)
    expect(v.kind).toBe('rising')
    expect(v.latest).toEqual({ month: '2026-11', label: 'Nov 2026', share: 30, calls: 300 })
    // earlier = (40 + 9 + 75) of (400 + 60 + 500) calls
    expect(v.earlier.from).toBe('Aug 2026')
    expect(v.earlier.to).toBe('Oct 2026')
    expect(v.earlier.calls).toBe(960)
    expect(v.earlier.share).toBeCloseTo((124 / 960) * 100, 6)
  })

  it('fading, steady, and too thin to say', () => {
    const read = (rows) => trendVerdict(trendRead({ query: 'q', match: '"q"', months: rows, total: 1 }).months)
    expect(read([month('2026-09', 200, 60), month('2026-10', 200, 20)]).kind).toBe('fading')
    // one point up is not rising, even though it is more than a quarter higher in ratio
    expect(read([month('2026-09', 1000, 20), month('2026-10', 1000, 30)]).kind).toBe('steady')
    // three points up but under a quarter higher is not rising either
    expect(read([month('2026-09', 100, 50), month('2026-10', 100, 53)]).kind).toBe('steady')
    // a month in progress with a handful of calls is not the latest month compared
    const partial = read([month('2026-09', 200, 20), month('2026-10', 200, 60), month('2026-11', MIN_MONTH_CALLS - 1, MIN_MONTH_CALLS - 1)])
    expect(partial.kind).toBe('rising')
    expect(partial.latest.month).toBe('2026-10')
    expect(read([month('2026-10', 200, 20), month('2026-11', 5, 5)])).toEqual({ kind: 'thin', latest: null, earlier: null })
    expect(read([month('2026-11', 200, 20)]).kind).toBe('thin')
    expect(trendVerdict(null).kind).toBe('thin')
    expect(Object.keys(TREND_WORDS).sort()).toEqual(['fading', 'rising', 'steady', 'thin'])
    // from nothing to something is rising; from something to nothing is fading
    expect(read([month('2026-09', 100, 0), month('2026-10', 100, 5)]).kind).toBe('rising')
    expect(read([month('2026-09', 100, 5), month('2026-10', 100, 0)]).kind).toBe('fading')
  })
})
