// RS screens, unit U8, item D3 on the page: "Why isn't a stock here?". A small text button under
// the list head of a screen whose starter has `row` opens a ticker box. On submit the page asks
// the server for that ONE row and checks the open screen's rules against it, then lists each
// rule with a tick or a cross and the stock's own value. Enter submits, Escape closes.
// (The rule-by-rule judging is whyNot.test.js; this file is the door, the requests and the words.)
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
import { RS_NOTE_PREF } from '../rsScreens'
import { net, resetNet, installFetch, mount, pin } from './rsHarness'
import { RANKED_LEADERS, TOP_RATING, PLAIN_STARTERS, SERVED, STARTERS_ON } from './rsScreensFixture'

// Unit U12: UCT RS Leaders is no longer a ranked screen (the rating pass keeps its list; what
// this panel says there is rsU12WhyNot.test.jsx's). Everything below is about ANY screen with a
// row, and about a ranked one, so it runs on the ranked shape Leaders had until then.
const LEADERS = RANKED_LEADERS

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  net.prefs = { [RS_NOTE_PREF]: '1' }
  // the registry the server serves for these screens, so each rule reads in its real words
  net.meta = { filters: SERVED.meta.filters, categories: [{ key: 'relative_strength', label: 'Relative strength' }], views: SERVED.meta.views }
  net.starters = [...STARTERS_ON, RANKED_LEADERS]
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
const openScreen = async name => {
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Open ${name}`) }))
}
// A stock that passes every rule of the ranked screen.
const PASSES = {
  ticker: 'TSLA', price: 300, dollar_vol_30d: 2e10, adr_pct: 4.1, market_cap: 9e11, rs_rank: 91, pct_vs_sma200: 22, sma200_rising: 1,
  dist_52w_high_pct: -9, rs_line_above_ma: 1, rs_flag: null, security_type: 'Stock', rs_rating_score: 61.5,
}
const open = async (starterId, name) => {
  pin([starterId])
  mount()
  await landedOn(name)
  await rowsIn()
  const user = userEvent.setup()
  await user.click(toggle())
  return user
}

describe('the door', () => {
  test('a screen without `row` has none; an RS screen has it under the list head, closed, and asks nothing', async () => {
    pin([PLAIN_STARTERS[0].id])
    mount()
    await landedOn(PLAIN_STARTERS[0].name)
    await rowsIn()
    expect(screen.queryByTestId('rs-why-not')).toBeNull()
    await openScreen('UCT RS Leaders')
    await landedOn('UCT RS Leaders')
    await waitFor(() => expect(toggle()).toBeInTheDocument())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Ticker' })).toBeNull()
    // under the list head (the Sort control), above the results
    const sort = screen.getByRole('button', { name: /^Sort:/ })
    const list = screen.getByRole('listbox')
    expect(sort.compareDocumentPosition(toggle()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toggle().compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(list.contains(toggle())).toBe(false)
    expect(rowCalls()).toEqual([])
  })

  test('opening it puts the cursor in the ticker box; Escape closes it and hands focus back', async () => {
    const user = await open(LEADERS.id, LEADERS.name)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(box()).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox', { name: 'Ticker' })).toBeNull()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveFocus()
    // the Close button does the same
    await user.click(toggle())
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('textbox', { name: 'Ticker' })).toBeNull()
  })

  test('typing a ticker never reaches the list\'s own keys (W adds to a watchlist, "/" opens the filters)', async () => {
    const user = await open(LEADERS.id, LEADERS.name)
    const before = fetch.mock.calls.length
    await user.type(box(), 'w/W')
    expect(box()).toHaveValue('w/W')
    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull()
    expect(screen.queryByTestId('focus-toast')).toBeNull()
    expect(fetch.mock.calls.slice(before).filter(([, o]) => o?.method === 'POST')).toEqual([])
  })
})

describe('the answer', () => {
  test('a stock on the list: said so, selected, and nothing is asked of the server', async () => {
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), 'amd{Enter}')
    expect(answer()).toHaveTextContent('AMD is on this list.')
    expect(screen.getByTestId('focus-row-AMD')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'AMD')
    expect(items()).toEqual([])
    expect(rowCalls()).toEqual([])
  })

  test('a stock that misses a rule: Enter asks for that one row, and each rule gets a tick or a cross with its value', async () => {
    net.row = t => (t === 'TSLA' ? { row: { ...PASSES, rs_rank: 74 }, stale: false } : null)
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), '$tsla{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('TSLA is not on this list. It misses 1 rule.'))
    // one request, for one row, naming a column for every rule of the screen and the ranking's own
    expect(rowCalls()).toHaveLength(1)
    const url = new URL(rowCalls()[0], 'http://x')
    expect(url.pathname).toBe('/api/screener/row/TSLA')
    const cols = url.searchParams.get('columns').split(',')
    for (const f of LEADERS.spec.filters) expect(cols).toContain(f.key)
    expect(cols).toContain('rs_rating_score')
    // every rule of the screen is listed, in the screen's order
    const got = items()
    expect(got).toHaveLength(LEADERS.spec.filters.length)
    expect(got.filter(([k]) => k === 'fail')).toHaveLength(1)
    const miss = got.find(([k]) => k === 'fail')[1]
    expect(miss).toMatch(/^✕Misses: RS R.*: 74$/)
    expect(got.filter(([k]) => k === 'pass').every(([, t]) => t.startsWith('✓Passes: '))).toBe(true)
    // its place in the ranking is not asked for: a stock that misses a rule has none
    expect(countBodies().filter(b => b.filters.some(f => f.key === 'rs_rating_score'))).toEqual([])
    // the list itself did not move
    expect(screen.getByTestId('focus-row-NVDA')).toHaveAttribute('aria-selected', 'true')
  })

  test('passes every rule but ranks outside the top 50: the place is counted, and said', async () => {
    net.row = () => ({ row: PASSES, stale: false })
    net.count = body => (body.filters.some(f => f.key === 'rs_rating_score') ? 62 : 5)
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('Passes every rule; ranked 63rd, the list shows the top 50'))
    expect(items().every(([k]) => k === 'pass')).toBe(true)
    const asked = countBodies().filter(b => b.filters.some(f => f.key === 'rs_rating_score'))
    expect(asked).toHaveLength(1)
    expect(asked[0].filters.at(-1)).toEqual({ key: 'rs_rating_score', op: 'gt', min: 61.5 })
    expect(asked[0].rank).toBeUndefined()
    for (const f of LEADERS.spec.filters) expect(asked[0].filters).toContainEqual(f)
  })

  test('a place the server would not count is never invented', async () => {
    net.row = () => ({ row: PASSES, stale: false })
    net.count = body => (body.filters.some(f => f.key === 'rs_rating_score') ? null : 5)
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent(/TSLA passes every rule on its latest numbers/))
    expect(answer()).not.toHaveTextContent(/ranked/)
  })

  test('passes every rule on a long list: further down than the rows loaded so far', async () => {
    net.scan = () => ({ rows: net.rows, total: 400 })
    net.row = () => ({ row: { ticker: 'TSLA', price: 300, dollar_vol_30d: 2e10, rs_rating_pos: 212, rs_flag: null, security_type: 'Stock' }, stale: false })
    const user = await open('starter_rs_top_rating', 'Top RS Rating')
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('Passes every rule. It is further down this list than the rows loaded so far.'))
    expect(items()).toHaveLength(TOP_RATING.spec.filters.length)
  })

  test('a stock whose price data stopped is left out of every screen, and the answer says so', async () => {
    net.row = () => ({ row: PASSES, stale: true })
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('its price data has stopped updating, so it is left out of every screen'))
  })

  test('a rule the row has no value for says "no value"', async () => {
    net.row = () => ({ row: { ...PASSES, adr_pct: null }, stale: false })
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('It misses 1 rule.'))
    expect(items().find(([k]) => k === 'fail')[1]).toMatch(/: no value$/)
  })

  test('an unknown ticker: "No such stock in the Screener."', async () => {
    net.row = () => null
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), 'ZZZZ{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('No such stock in the Screener.'))
    expect(items()).toEqual([])
  })

  test('something that is not a ticker is not sent anywhere', async () => {
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), 'NV DA{Enter}')
    expect(answer()).toHaveTextContent('Type a ticker, like NVDA.')
    await user.clear(box())
    await user.type(box(), '{Enter}')
    expect(answer()).toHaveTextContent('Type a ticker, like NVDA.')
    expect(rowCalls()).toEqual([])
  })

  test('a refusal or a dropped connection is "could not be checked", never a verdict', async () => {
    net.row = () => ({ status: 500 })
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('That could not be checked just now. Try again.'))
    expect(answer()).not.toHaveTextContent(/is not on this list|passes/i)
    net.row = () => { throw new Error('offline') }
    await user.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => expect(rowCalls()).toHaveLength(2))
    await waitFor(() => expect(answer()).toHaveTextContent('That could not be checked just now. Try again.'))
  })

  test('the Check button asks the same question as Enter', async () => {
    net.row = () => ({ row: { ...PASSES, rs_rank: 74 }, stale: false })
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), 'tsla')
    await user.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => expect(answer()).toHaveTextContent('TSLA is not on this list. It misses 1 rule.'))
  })

  test('an answer is about the screen it was asked of: another screen starts with none', async () => {
    net.row = () => ({ row: { ...PASSES, rs_rank: 74 }, stale: false })
    const user = await open(LEADERS.id, LEADERS.name)
    await user.type(box(), 'TSLA{Enter}')
    await waitFor(() => expect(answer()).toHaveTextContent('TSLA is not on this list.'))
    await openScreen('Top RS Rating')
    await landedOn('Top RS Rating')
    await waitFor(() => expect(answer()).toBeEmptyDOMElement())
  })
})
