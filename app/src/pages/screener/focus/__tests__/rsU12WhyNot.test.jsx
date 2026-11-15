// RS screens, unit U12, item W3.3: "Why isn't a stock here?" after the steadier list.
//   · RS exit warnings does not offer it: a warning is something that happened to a stock, not a
//     list it can qualify for, so there is no rule to point at.
//   · UCT RS Leaders keeps its own list (the server joins a stock at 50th or better and keeps it to
//     65th). Its membership clause is the ANSWER, never one of the rules: a stock that passes
//     every rule and is not listed is told its rank among the qualifiers and how the list is kept.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, describe, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { RS_NOTE_PREF, RS_CONTROLS_PREF, steadyOf } from '../rsScreens'
import { whyNotHeadline, steadyAheadSpec, rulesWithout } from '../whyNot'
import { net, resetNet, installFetch, mount, pin } from './rsHarness'
import { TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS, SERVED } from './rsScreensFixture'

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  net.prefs = { [RS_NOTE_PREF]: '1' }
  net.meta = { filters: SERVED.meta.filters, categories: [{ key: 'relative_strength', label: 'Relative strength' }], views: SERVED.meta.views }
  installFetch()
})
const landedOn = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())
const rowsIn = () => waitFor(() => screen.getByTestId('focus-row-NVDA'))
const toggle = () => screen.getByRole('button', { name: "Why isn't a stock here?" })
const box = () => screen.getByRole('textbox', { name: 'Ticker' })
const answer = () => screen.getByTestId('rs-why-not-answer')
const rowCalls = () => fetch.mock.calls.map(([u]) => String(u)).filter(u => u.startsWith('/api/screener/row/'))
const countBodies = () => fetch.mock.calls.filter(([u]) => String(u) === '/api/screener/count').map(([, o]) => JSON.parse(o.body))
const items = () => within(answer()).queryAllByRole('listitem').map(li => [li.getAttribute('data-kind'), li.textContent])
const STEADY = steadyOf(LEADERS)
const RULE = 'the list holds the top 50 (a listed stock stays until it falls past 65th)'
// A stock that passes every rule of UCT RS Leaders and is NOT on the list the server keeps.
const QUALIFIES = {
  ticker: 'TSLA', price: 300, dollar_vol_30d: 2e10, adr_pct: 4.1, market_cap: 9e11, rs_rank: 91, pct_vs_sma200: 22, sma200_rising: 1,
  dist_52w_high_pct: -9, rs_line_above_ma: 1, rs_flag: null, security_type: 'Stock', rs_rating_score: 61.5, rs_leaders_member: 0,
}
const ranksAhead = body => body.filters.some(f => f.key === 'rs_rating_score' && f.op === 'gt')
const open = async (starterId, name) => {
  pin([starterId])
  mount()
  await landedOn(name)
  await rowsIn()
  const user = userEvent.setup()
  await user.click(toggle())
  return user
}

describe('where the door is', () => {
  test.each([[TOP_RATING], [NEW_HIGHS], [BEFORE_PRICE], [LEADERS]].map(([st]) => [st.name, st]))('%s (a list screen) offers it', async (_n, st) => {
    pin([st.id])
    mount()
    await landedOn(st.name)
    await rowsIn()
    expect(toggle()).toBeInTheDocument()
  })

  test('RS exit warnings does not: no button, no box, nothing asked', async () => {
    pin([EXIT_WARNINGS.id])
    mount()
    await landedOn('RS exit warnings')
    await rowsIn()
    expect(screen.getByTestId('focus-row-NVDA')).toHaveAttribute('data-rs-row')
    expect(screen.queryByTestId('rs-why-not')).toBeNull()
    expect(screen.queryByRole('button', { name: "Why isn't a stock here?" })).toBeNull()
    expect(rowCalls()).toEqual([])
  })
})

describe('the words', () => {
  test('a rank, then how the list is kept, in the owner\'s sentence', () => {
    expect(whyNotHeadline({ ticker: 'TSLA', position: 63, steady: STEADY }))
      .toBe('Passes every rule; ranked 63rd, the list holds the top 50 (a listed stock stays until it falls past 65th).')
    // a rank inside the top 50 is said too: the places are held by listed stocks
    expect(whyNotHeadline({ ticker: 'TSLA', position: 44, steady: STEADY })).toBe(`Passes every rule; ranked 44th, ${RULE}.`)
    expect(whyNotHeadline({ ticker: 'TSLA', position: 1, steady: STEADY })).toBe(`Passes every rule; ranked 1st, ${RULE}.`)
    // the two numbers are the starter's, never typed
    expect(whyNotHeadline({ ticker: 'TSLA', position: 30, steady: { ...STEADY, enter: 25, hold: 40 } }))
      .toBe('Passes every rule; ranked 30th, the list holds the top 25 (a listed stock stays until it falls past 40th).')
  })
  test('a rank the server would not count is never invented', () => {
    expect(whyNotHeadline({ ticker: 'TSLA', position: null, steady: STEADY })).toBe(`TSLA passes every rule and is not on the list today: ${RULE}.`)
  })
  test('a missed rule, a stale row and an unchecked rule still come first', () => {
    expect(whyNotHeadline({ ticker: 'TSLA', failed: 1, position: 63, steady: STEADY })).toBe('TSLA is not on this list. It misses 1 rule.')
    expect(whyNotHeadline({ ticker: 'TSLA', stale: true, position: 63, steady: STEADY })).toMatch(/price data has stopped updating/)
    expect(whyNotHeadline({ ticker: 'TSLA', unknown: 1, position: 63, steady: STEADY })).toBe('TSLA passes every rule that can be checked here.')
    expect(whyNotHeadline({ ticker: 'TSLA', onList: true, steady: STEADY })).toBe('TSLA is on this list.')
  })
  test('without such a list the sentences are the ones they were', () => {
    expect(whyNotHeadline({ ticker: 'TSLA', position: 63, topN: 50 })).toBe('Passes every rule; ranked 63rd, the list shows the top 50')
    expect(whyNotHeadline({ ticker: 'TSLA', hasMore: true })).toBe('Passes every rule. It is further down this list than the rows loaded so far.')
  })
})

describe('where the stock ranks among the qualifiers', () => {
  test('the count is the STARTER\'S qualifying rules plus "ranks ahead of this stock"', () => {
    const spec = steadyAheadSpec({ steady: STEADY, row: QUALIFIES })
    expect(spec.filters.slice(0, -1)).toEqual(LEADERS.spec.filters.filter(f => f.key !== 'rs_leaders_member'))
    expect(spec.filters.at(-1)).toEqual({ key: 'rs_rating_score', op: 'gt', min: 61.5 })
    expect(spec.filters.map(f => f.key)).not.toContain('rs_leaders_member')
    expect(Object.keys(spec)).toEqual(['filters'])
  })
  test('no list, or a row with no score: nothing is asked', () => {
    expect(steadyAheadSpec({ steady: null, row: QUALIFIES })).toBeNull()
    expect(steadyAheadSpec({ steady: STEADY, row: { ...QUALIFIES, rs_rating_score: null } })).toBeNull()
    expect(steadyAheadSpec({ steady: STEADY, row: {} })).toBeNull()
  })
  test('the membership clause is taken out of the rules, and nothing else is', () => {
    const keyed = Object.fromEntries(LEADERS.spec.filters.map(({ key, ...rest }) => [key, rest]))
    const rules = rulesWithout(keyed, 'rs_leaders_member')
    expect(Object.keys(rules)).toEqual(Object.keys(keyed).filter(k => k !== 'rs_leaders_member'))
    expect(rulesWithout(keyed, null)).toBe(keyed)
    expect(rulesWithout(null, 'x')).toEqual({})
  })
})

describe('on UCT RS Leaders', () => {
  test('passes every rule and is not listed: its rank, and how the list is kept', async () => {
    net.row = () => ({ row: QUALIFIES, stale: false })
    net.count = body => (ranksAhead(body) ? 62 : 5)
    const user = await open('starter_rs_leaders', 'UCT RS Leaders')
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent(`Passes every rule; ranked 63rd, ${RULE}.`))
    // every rule is a tick, and the membership clause is not listed among them
    const got = items()
    expect(got).toHaveLength(LEADERS.spec.filters.length - 1)
    expect(got.every(([k]) => k === 'pass')).toBe(true)
    expect(got.some(([, t]) => /On the UCT RS Leaders list|rs_leaders_member/.test(t))).toBe(false)
    // the row was asked for the rules' columns, the membership column and the score
    const cols = new URL(rowCalls()[0], 'http://x').searchParams.get('columns').split(',')
    for (const f of LEADERS.spec.filters) expect(cols).toContain(f.key)
    expect(cols).toContain('rs_rating_score')
    // and ONE count placed it: the starter's own qualifying rules, without the membership clause
    const asked = countBodies().filter(ranksAhead)
    expect(asked).toHaveLength(1)
    expect(asked[0].filters).toEqual([...STEADY.gate, { key: 'rs_rating_score', op: 'gt', min: 61.5 }])
    expect(asked[0].filters.map(f => f.key)).not.toContain('rs_leaders_member')
  })

  test('ranked inside the top 50 and still not listed: the same sentence explains why', async () => {
    net.row = () => ({ row: QUALIFIES, stale: false })
    net.count = body => (ranksAhead(body) ? 43 : 5)
    const user = await open('starter_rs_leaders', 'UCT RS Leaders')
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent(`Passes every rule; ranked 44th, ${RULE}.`))
  })

  test('a stock that misses a rule is told the rule, and membership is not counted as one', async () => {
    net.row = () => ({ row: { ...QUALIFIES, rs_rank: 74 }, stale: false })
    const user = await open('starter_rs_leaders', 'UCT RS Leaders')
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('TSLA is not on this list. It misses 1 rule.'))
    expect(items().filter(([k]) => k === 'fail')).toHaveLength(1)
    expect(items().find(([k]) => k === 'fail')[1]).toMatch(/RS R.*: 74$/)
    expect(countBodies().filter(ranksAhead)).toEqual([])
  })

  test('a row that does not carry the membership column is read as not listed, never as listed', async () => {
    const { rs_leaders_member: _gone, ...bare } = QUALIFIES
    net.row = () => ({ row: bare, stale: false })
    net.count = body => (ranksAhead(body) ? 70 : 5)
    const user = await open('starter_rs_leaders', 'UCT RS Leaders')
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent(`Passes every rule; ranked 71st, ${RULE}.`))
  })

  test('a rank the server would not count is not invented', async () => {
    net.row = () => ({ row: QUALIFIES, stale: false })
    net.count = body => (ranksAhead(body) ? null : 5)
    const user = await open('starter_rs_leaders', 'UCT RS Leaders')
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent(`TSLA passes every rule and is not on the list today: ${RULE}.`))
    expect(answer()).not.toHaveTextContent(/ranked/)
  })

  test('a stock whose price data stopped is said so, and no rank is asked', async () => {
    net.row = () => ({ row: QUALIFIES, stale: true })
    const user = await open('starter_rs_leaders', 'UCT RS Leaders')
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('its price data has stopped updating, so it is left out of every screen'))
    expect(countBodies().filter(ranksAhead)).toEqual([])
  })

  test('a listed stock the member narrowed away is told the narrowed rule it misses', async () => {
    // Min RS Rating 90 chosen: a listed stock rated 85 is not on the screen, and the reason is the rule
    net.prefs = { [RS_NOTE_PREF]: '1', [RS_CONTROLS_PREF]: JSON.stringify({ starter_rs_leaders: { min: 'r90' } }) }
    net.row = () => ({ row: { ...QUALIFIES, rs_rank: 85, rs_leaders_member: 1 }, stale: false })
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders \\(edited\\)')
    await rowsIn()
    const user = userEvent.setup()
    await user.click(toggle())
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('TSLA is not on this list. It misses 1 rule.'))
    expect(items().find(([k]) => k === 'fail')[1]).toMatch(/90.*: 85$/)
  })

  test('with the screen narrowed, the rank is still counted on the starter\'s own rules', async () => {
    net.prefs = { [RS_NOTE_PREF]: '1', [RS_CONTROLS_PREF]: JSON.stringify({ starter_rs_leaders: { min: 'r90' } }) }
    net.row = () => ({ row: { ...QUALIFIES, rs_rank: 95 }, stale: false })
    net.count = body => (ranksAhead(body) ? 57 : 5)
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders \\(edited\\)')
    await rowsIn()
    const user = userEvent.setup()
    await user.click(toggle())
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent(`Passes every rule; ranked 58th, ${RULE}.`))
    const asked = countBodies().filter(ranksAhead)
    expect(asked).toHaveLength(1)
    // the server ranks on RS Rating 80 and up (the starter's rule), whatever the member chose
    expect(asked[0].filters).toContainEqual({ key: 'rs_rank', op: 'gte', min: 80 })
    expect(asked[0].filters).not.toContainEqual({ key: 'rs_rank', op: 'gte', min: 90 })
  })

  test('a stock on the list is still found and selected without asking anything', async () => {
    const user = await open('starter_rs_leaders', 'UCT RS Leaders')
    await user.type(box(), 'amd{Enter}')
    expect(answer()).toHaveTextContent('AMD is on this list.')
    expect(rowCalls()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  })
})

describe('a screen that keeps no list of its own', () => {
  test('Top RS Rating reads every one of its rules and asks for no rank', async () => {
    net.row = () => ({ row: { ticker: 'TSLA', price: 300, dollar_vol_30d: 2e10, rs_rating_pos: null, rs_flag: null, security_type: 'Stock' }, stale: false })
    const user = await open('starter_rs_top_rating', 'Top RS Rating')
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('TSLA is not on this list. It misses 1 rule.'))
    expect(items()).toHaveLength(TOP_RATING.spec.filters.length)
    expect(steadyOf(TOP_RATING)).toBeNull()
    expect(countBodies().filter(ranksAhead)).toEqual([])
  })
})
