// "Why isn't a stock here?" (RS screens unit U8, item D3): the pure half. Each rule of the open
// screen is judged against ONE row the way the scan judges it, and worded the way the
// "Why it's here" strip words it. Read on the starters and the registry the SERVER serves
// (rsScreensFixture reads the server suite's goldens).
import { describe, expect, test } from 'vitest'
import {
  cleanTicker, evaluateRules, whyNotColumns, rankCriterion, rankAheadSpec, ordinal, whyNotHeadline,
  NO_VALUE, NOT_CHECKED,
} from '../whyNot'
import { whyItsHere } from '../whyItsHere'
import { LEADERS, RANKED_LEADERS, TOP_RATING, BEFORE_PRICE, SERVED } from './rsScreensFixture'

const META = SERVED.meta.filters
// A starter's filter LIST as the page holds it: keyed by filter key.
const keyed = st => Object.fromEntries(st.spec.filters.map(({ key, ...rest }) => [key, rest]))
// A stock that is on UCT RS Leaders: every rule of the screen passes (unit U12: the last of
// them is the list itself, `rs_leaders_member`, which the rating pass stores).
const LEADER = {
  ticker: 'NVDA', price: 140, dollar_vol_30d: 9e9, adr_pct: 4.2, market_cap: 3.4e12, rs_rank: 97, pct_vs_sma200: 31,
  sma200_rising: 1, dist_52w_high_pct: -4, rs_line_above_ma: 1, rs_flag: null, security_type: 'Stock', rs_rating_score: 88.4,
  rs_leaders_member: 1,
}
const evalLeaders = row => evaluateRules({ filters: keyed(LEADERS), metaFilters: META, row })
const byLabel = (ev, re) => ev.items.find(i => re.test(i.label))

describe('the ticker a member types', () => {
  test.each([
    ['nvda', 'NVDA'], [' NVDA ', 'NVDA'], ['$nvda', 'NVDA'], ['brk.b', 'BRK.B'], ['BF-B', 'BF-B'], ['A', 'A'], ['3M', '3M'],
  ])('"%s" is %s', (raw, t) => { expect(cleanTicker(raw)).toBe(t) })
  test.each([[''], ['   '], ['$'], ['NV DA'], ['NVDA;DROP'], ['../etc'], ['.B'], ['-B'], ['ABCDEFGHIJKLM'], [null], [undefined], ['NVDA/AMD']])(
    '"%s" is not a ticker', raw => { expect(cleanTicker(raw)).toBe('') })
})

describe('every rule of the screen, against one row', () => {
  test('a stock that belongs passes every rule, and each line carries its own value', () => {
    const ev = evalLeaders(LEADER)
    expect(ev.failed).toBe(0)
    expect(ev.unknown).toBe(0)
    expect(ev.firstFailed).toBe('')
    expect(ev.items).toHaveLength(LEADERS.spec.filters.length)
    expect(ev.items.every(i => i.kind === 'pass')).toBe(true)
    expect(byLabel(ev, /^RS R/).value).toBe('97')
    // a blank Setup flag is not a "Buyout pending" stock: the scan keeps it, so it is a tick
    expect(byLabel(ev, /not Buyout pending/)).toMatchObject({ kind: 'pass', value: 'none' })
  })

  test('each rule is worded exactly as the "Why it\'s here" strip words it', () => {
    const ev = evalLeaders(LEADER)
    // the strip shows five; with a rank and no facts, its first five are this screen's first five rules
    const strip = whyItsHere({ filters: keyed(LEADERS), metaFilters: META, row: LEADER })
    expect(ev.items.slice(0, strip.items.length).map(i => i.label)).toEqual(strip.items.map(i => i.label))
    expect(ev.items.slice(0, strip.items.length).map(i => i.value)).toEqual(strip.items.map(i => i.value === 'None' ? 'none' : i.value))
  })

  test('a rule the stock misses is a cross with the stock\'s own number', () => {
    const ev = evalLeaders({ ...LEADER, rs_rank: 74 })
    expect(ev.failed).toBe(1)
    const rule = byLabel(ev, /^RS R/)
    expect(rule.kind).toBe('fail')
    expect(rule.value).toBe('74')
    expect(ev.firstFailed).toBe(`${rule.label}: 74`)
    expect(ev.items.filter(i => i.kind === 'pass')).toHaveLength(LEADERS.spec.filters.length - 1)
  })

  test('several misses are all listed, and the first one in the screen\'s order is the first failed rule', () => {
    const ev = evalLeaders({ ...LEADER, price: 4, rs_rank: 60, sma200_rising: 0 })
    expect(ev.failed).toBe(3)
    expect(ev.firstFailed).toMatch(/^Price/)
    expect(ev.firstFailed).toMatch(/\$4$/)
  })

  test.each([
    // [what, key, value the row holds, the screen's clause, passes?]
    ['at least: on the line', 'rs_rank', 80, { op: 'gte', min: 80 }, true],
    ['at least: just under', 'rs_rank', 79, { op: 'gte', min: 80 }, false],
    ['more than: on the line is not more', 'pct_vs_sma200', 0, { op: 'gt', min: 0 }, false],
    ['more than: above', 'pct_vs_sma200', 0.01, { op: 'gt', min: 0 }, true],
    ['under: on the line is not under', 'rs_rating_prev20', 90, { op: 'lt', max: 90 }, false],
    ['under: below', 'rs_rating_prev20', 89, { op: 'lt', max: 90 }, true],
    ['at most: on the line', 'rs_rank', 80, { op: 'lte', max: 80 }, true],
    ['between: the low end', 'px_below_high_pct', -25, { op: 'between', min: -25, max: -3 }, true],
    ['between: the high end', 'px_below_high_pct', -3, { op: 'between', min: -25, max: -3 }, true],
    ['between: past the high end', 'px_below_high_pct', -2.9, { op: 'between', min: -25, max: -3 }, false],
    ['between: past the low end', 'px_below_high_pct', -25.1, { op: 'between', min: -25, max: -3 }, false],
    ['a yes/no rule that wants yes, on a yes', 'sma200_rising', 1, { op: 'eq', value: 1 }, true],
    ['a yes/no rule that wants yes, on a no', 'sma200_rising', 0, { op: 'eq', value: 1 }, false],
    ['a yes/no rule that wants no, on a no', 'sma200_rising', 0, { op: 'eq', value: 0 }, true],
    ['equals: the same word', 'rs_exit_last', 'Quicksand', { op: 'eq', value: 'Quicksand' }, true],
    ['equals: another word', 'rs_exit_last', 'Quick Break', { op: 'eq', value: 'Quicksand' }, false],
    ['one of: listed', 'rs_setup', 'at_pivot', { op: 'in', values: ['at_pivot', 'pullback_8'] }, true],
    ['one of: not listed', 'rs_setup', 'extended', { op: 'in', values: ['at_pivot', 'pullback_8'] }, false],
    ['not one of: listed', 'rs_setup', 'extended', { op: 'not_in', values: ['extended', 'below_50'] }, false],
    ['not one of: not listed', 'rs_setup', 'at_pivot', { op: 'not_in', values: ['extended', 'below_50'] }, true],
    ['one of, over a stored token list', 'candle', ',hammer,doji,', { op: 'in', values: ['doji'] }, true],
    ['not one of, over a stored token list', 'candle', ',hammer,doji,', { op: 'not_in', values: ['doji'] }, false],
    ['a token is matched whole, never by a part of it', 'candle', ',bullish-hammer,', { op: 'in', values: ['hammer'] }, false],
  ])('%s', (_n, key, value, spec, ok) => {
    const ev = evaluateRules({ filters: { [key]: spec }, metaFilters: META, row: { [key]: value } })
    expect(ev.items).toHaveLength(1)
    expect(ev.items[0].kind).toBe(ok ? 'pass' : 'fail')
  })

  test.each([
    ['at least', { op: 'gte', min: 80 }],
    ['between', { op: 'between', min: 0, max: 4 }],
    ['equals', { op: 'eq', value: 1 }],
    ['one of', { op: 'in', values: ['at_pivot'] }],
  ])('a blank value fails "%s" and says "no value", never a number', (_n, spec) => {
    for (const blank of [null, undefined, '', NaN]) {
      const ev = evaluateRules({ filters: { rs_rank: spec }, metaFilters: META, row: { rs_rank: blank } })
      expect(ev.items[0]).toMatchObject({ kind: 'fail', value: NO_VALUE })
      expect(ev.firstFailed.endsWith(`: ${NO_VALUE}`)).toBe(true)
    }
  })
  test('a blank value PASSES an exclude list, as it does on the server', () => {
    const ev = evaluateRules({ filters: { security_type: { op: 'not_in', values: ['ETF'] } }, metaFilters: META, row: {} })
    expect(ev.items[0]).toMatchObject({ kind: 'pass', value: 'none' })
    expect(ev.failed).toBe(0)
  })

  test('a rule one row cannot settle is "not checked here", and is never counted as passed', () => {
    const ev = evaluateRules({
      filters: { universe: { op: 'eq', value: 'uct', label: 'UCT Universe' }, list: { op: 'in', value: 3, label: 'Swing ideas' },
        scan: { op: 'in', value: 'abc', label: 'Gappers' }, price: { op: 'gte_col', other: 'sma50' }, rs_rank: { op: 'gte', min: 80 } },
      logic: { all: [] }, metaFilters: META, row: { rs_rank: 97, price: 10 },
    })
    expect(ev.items.map(i => i.kind)).toEqual(['unknown', 'unknown', 'unknown', 'unknown', 'pass', 'unknown'])
    expect(ev.items.filter(i => i.kind === 'unknown').every(i => i.value === NOT_CHECKED)).toBe(true)
    expect(ev.items[0].label).toBe('In UCT Universe')
    expect(ev.items[1].label).toBe('In Swing ideas')
    expect(ev.items.at(-1).label).toBe('Your custom criteria')
    expect(ev.unknown).toBe(5)
    expect(ev.failed).toBe(0)
  })
  test('a number rule over a value that is not a number is not guessed', () => {
    const ev = evaluateRules({ filters: { rs_rank: { op: 'gte', min: 80 } }, metaFilters: META, row: { rs_rank: '97' } })
    expect(ev.items[0].kind).toBe('unknown')
  })
  test('nothing to check is nothing said', () => {
    expect(evaluateRules()).toEqual({ items: [], failed: 0, unknown: 0, firstFailed: '' })
    expect(evaluateRules({ filters: { rs_rank: null } }).items).toEqual([])
  })
})

describe('the columns asked of the server', () => {
  test('every rule the page can judge, and the one column a single-criterion ranking orders by', () => {
    const cols = whyNotColumns(keyed(RANKED_LEADERS), RANKED_LEADERS.spec.rank)
    for (const f of RANKED_LEADERS.spec.filters) expect(cols).toContain(f.key)
    expect(cols).toContain('rs_rating_score')
    expect(new Set(cols).size).toBe(cols.length)
    // an unranked screen asks for its rules only
    expect(whyNotColumns(keyed(TOP_RATING), null).sort()).toEqual(TOP_RATING.spec.filters.map(f => f.key).sort())
  })
  test('a pool, a scan join and a field-to-field rule name no column to ask for', () => {
    expect(whyNotColumns({ universe: { op: 'eq', value: 'uct' }, scan: { op: 'in', value: 'x' }, price: { op: 'gte_col', other: 'sma50' } }, null)).toEqual([])
  })
})

describe('where the stock ranks', () => {
  test('only a single-criterion ranking can be placed', () => {
    expect(rankCriterion(RANKED_LEADERS.spec.rank)).toEqual({ key: 'rs_rating_score', ascending: false })
    expect(rankCriterion({ criteria: [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }], top_n: 50 })).toBeNull()
    expect(rankCriterion({ criteria: [] })).toBeNull()
    expect(rankCriterion(null)).toBeNull()
    expect(rankCriterion({ criteria: [{ key: 'adr_pct', weight: 2, ascending: true }] })).toEqual({ key: 'adr_pct', ascending: true })
  })
  test('the count asked is the screen\'s own rules plus "ranks ahead of this stock"', () => {
    const spec = rankAheadSpec({ filterList: RANKED_LEADERS.spec.filters, rank: RANKED_LEADERS.spec.rank, row: LEADER })
    expect(spec.filters.slice(0, -1)).toEqual(RANKED_LEADERS.spec.filters)
    expect(spec.filters.at(-1)).toEqual({ key: 'rs_rating_score', op: 'gt', min: 88.4 })
    expect(spec.rank).toBeUndefined()           // a count of stocks, never the capped ranked list
    expect('logic' in spec).toBe(false)
    // lower is better: the stocks ahead are the ones under it
    const asc = rankAheadSpec({ filterList: [], rank: { criteria: [{ key: 'adr_pct', weight: 1, ascending: true }], top_n: 10 }, row: { adr_pct: 3 } })
    expect(asc.filters).toEqual([{ key: 'adr_pct', op: 'lt', max: 3 }])
    // the screen's custom criteria ride along
    expect(rankAheadSpec({ filterList: [], logic: { all: [] }, rank: RANKED_LEADERS.spec.rank, row: LEADER }).logic).toEqual({ all: [] })
  })
  test('no ranking, several criteria, or a row with no value to compare: nothing is asked', () => {
    expect(rankAheadSpec({ filterList: [], rank: null, row: LEADER })).toBeNull()
    expect(rankAheadSpec({ filterList: [], rank: RANKED_LEADERS.spec.rank, row: { ...LEADER, rs_rating_score: null } })).toBeNull()
    expect(rankAheadSpec({ filterList: [], rank: { criteria: [{ key: 'a' }, { key: 'b' }] }, row: { a: 1, b: 2 } })).toBeNull()
  })
  test.each([[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [22, '22nd'], [63, '63rd'],
    [101, '101st'], [111, '111th'], [112, '112th'], [1203, '1,203rd']])('%s is "%s"', (n, s) => { expect(ordinal(n)).toBe(s) })
})

describe('the sentence that leads the answer', () => {
  const h = o => whyNotHeadline({ ticker: 'NVDA', ...o })
  test('on the list', () => { expect(h({ onList: true })).toBe('NVDA is on this list.') })
  test('on the list, hidden by New only', () => { expect(h({ hiddenNew: true })).toBe('NVDA is on this list. It is hidden while New only is on.') })
  test('misses one rule, or several', () => {
    expect(h({ failed: 1 })).toBe('NVDA is not on this list. It misses 1 rule.')
    expect(h({ failed: 3, unknown: 2, stale: true })).toBe('NVDA is not on this list. It misses 3 rules.')
  })
  test('passes every rule and is outside the top N: the brief\'s own sentence', () => {
    expect(h({ position: 63, topN: 50 })).toBe('Passes every rule; ranked 63rd, the list shows the top 50')
    expect(h({ position: 51, topN: 50 })).toBe('Passes every rule; ranked 51st, the list shows the top 50')
  })
  test('ranked inside the top N is never said to be outside it', () => {
    expect(h({ position: 50, topN: 50 })).not.toMatch(/ranked/)
    expect(h({ position: 7, topN: 50, hasMore: true })).toBe('Passes every rule. It is further down this list than the rows loaded so far.')
  })
  test('a place that could not be read is never invented', () => {
    expect(h({ position: null, topN: 50 })).not.toMatch(/ranked/)
  })
  test('passes every rule on a long list: further down than the rows loaded', () => {
    expect(h({ hasMore: true })).toBe('Passes every rule. It is further down this list than the rows loaded so far.')
  })
  test('some rules could not be checked: the sentence claims only the ones that were', () => {
    expect(h({ unknown: 1 })).toBe('NVDA passes every rule that can be checked here.')
    expect(h({ unknown: 1, position: 63, topN: 50 })).toBe('NVDA passes every rule that can be checked here.')
  })
  test('a stock whose price data stopped is left out of every screen, and the answer says so', () => {
    expect(h({ stale: true })).toBe('NVDA passes the rules below, but its price data has stopped updating, so it is left out of every screen.')
  })
  test('passes every rule, the whole list is loaded and it is not there: the two reads are a moment apart', () => {
    expect(h({})).toBe('NVDA passes every rule on its latest numbers. The list on screen was loaded a moment earlier and refreshes on its own.')
  })
  test('no sentence gives advice or uses a banned word', () => {
    const all = [h({ onList: true }), h({ hiddenNew: true }), h({ failed: 2 }), h({ position: 63, topN: 50 }), h({ hasMore: true }), h({ unknown: 1 }), h({ stale: true }), h({})]
    for (const s of all) expect(s).not.toMatch(/\b(buy|sell|buyable|should|lens|gate|RSI)\b/i)
  })
})

test('RS New High Before Price: a stock already at its high misses the "below its high" rule, with its own number', () => {
  const row = { price: 50, dollar_vol_30d: 5e7, pct_vs_sma200: 12, rs_nhbp_age: 1, px_below_high_pct: -0.4, rs_flag: null, security_type: 'Stock' }
  const ev = evaluateRules({ filters: keyed(BEFORE_PRICE), metaFilters: META, row })
  expect(ev.failed).toBe(1)
  expect(ev.firstFailed).toMatch(/-0\.4%$/)
})
