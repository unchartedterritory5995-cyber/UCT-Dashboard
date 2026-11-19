// FLWL: Cream of the Crop and the open flow board. Rails:
//   * the pure shaping: the words a list is typed as, a store date as a calendar date, the Cream
//     of the Crop rows (bullish first, the server's own order, a new strike told apart from a
//     ratio), the board rows (one per stock, biggest net premium first in either direction, the
//     bullish share read as the percent the server sends);
//   * ONE list is read at a time: the list that is not on screen is never asked for;
//   * loading, a failed read (error with Retry), a paywall and a switched-off route (no Retry),
//     signed out;
//   * the board's "computing" answer is a building state, its "error" answer is an error with
//     Retry, and neither is an empty list; an answer that is not the route's shape is an error;
//   * a healthy answer with no rows says nothing qualified, and for which date;
//   * a symbol loads into the linked panels; row numbers follow the rows on screen;
//   * the chips switch the list and write nothing back where the registry does not take the word.
// The fixtures are the routes' real shapes (api/live_massive_router.py compute_cream,
// api/weekly_flow.py _board_compute), with made-up tickers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import FlowListsPanel, {
  BOARD_DAYS, BOARD_LIMIT, CREAM_URL, FLOW_BOARD_URL, FLOW_LISTS, FLOW_LISTS_CODE, MAX_ROWS, boardRead, contractText, creamRead,
  directionWords, flowListsCommandArgs, isoDay, normFlowList, optionSide, parseFlowList,
} from './FlowListsPanel'
import { stampedKey } from './marketRead'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT options flow'
const CREAM = {
  date: '11/16/2026',
  bull: [
    { sym: 'AAA', cp: 'C', strike: 420, exp: '12/18/2026', prem: 2240000.0, vol: 5300, oi: 1200, voi: 4.4, grade: 'A', dte: 32, tier: 'alpha', _dir: 'Bull', _agg: 2240000.0, unconfirmed: false },
    { sym: 'bbb', cp: 'C', strike: 27.5, exp: '1/15/2027', prem: 1100000.0, vol: 900, oi: 0, voi: null, grade: 'B', dte: 60, tier: 'size', _dir: 'Bull', _agg: 1100000.0, unconfirmed: true },
  ],
  bear: [
    { sym: 'CCC', cp: 'P', strike: 150, exp: '3/19/2027', prem: 3500000.0, vol: 2100, oi: 800, voi: 2.6, grade: 'A+', dte: 123, tier: 'alpha_leaps', _dir: 'Bear', _agg: 3500000.0, unconfirmed: false },
  ],
  net: { bull: 812000000.0, bear: 640000000.0 },
  two_sided: [{ sym: 'DDD', bull: 6100000, bear: 10000000 }],
  dropped: { far_dated: 2 },
  params: {
    top_n: 12, min_voi: 1.0, exclude_weekly: true, exclude_block_only: true, max_per_ticker: 2, include_size: true,
    size_min_ask: 1000000.0, min_dte: 7, min_sweep_prem: 100000.0, max_dte: 365, max_otm_pct: 40.0, fresh_min_vol: 100,
    two_sided_ratio: 2.0, min_grade: 'C',
  },
}
const CREAM_EMPTY = { ...CREAM, bull: [], bear: [], two_sided: [], net: { bull: 0.0, bear: 0.0 }, dropped: {} }
const BOARD = {
  ok: true,
  rows: [
    { sym: 'AAA', bull: 5200000.0, bear: 800000.0, net: 4400000.0, bullPct: 87, cp: 'C', strike: 420, exp: '12/18/2026', dte: 32, since: '2026-10-02', perf: 6.4 },
    { sym: 'BBB', bull: 1500000.0, bear: 300000.0, net: 1200000.0, bullPct: 83, cp: 'C', strike: 27.5, exp: '1/15/2027', dte: 60, since: '2026-11-03', perf: null },
    { sym: 'CCC', bull: 400000.0, bear: 9900000.0, net: -9500000.0, bullPct: 4, cp: 'P', strike: 150, exp: '3/19/2027', dte: 123, since: '2026-09-21', perf: -11.2 },
  ],
  window: ['11/12/2026', '11/13/2026', '11/16/2026'],
  n_names: 3,
  open_contracts: 41,
  days: 60,
  cap: 'all',
  min_dte: 30,
  built_at: 1794836400.123,
}
const COMPUTING = { ok: false, reason: 'computing', rows: [] }
const BUILD_FAILED = { ok: false, reason: 'error: database is locked', rows: [] }

const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
const PENDING = Symbol('pending')
/** Serves each URL its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    if (!(url in routes)) return Promise.reject(fail(500))
    const hit = routes[url]
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => jsonFetcher.mock.calls.map(([url]) => url)

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <FlowListsPanel {...props} />
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, rerun, publishRows, setFreshness }
}
const rowsOf = (testId) => within(screen.getByTestId(testId)).getAllByRole('row').slice(1)
const symsIn = (testId) => rowsOf(testId).map((r) => r.getAttribute('data-testid').replace('terminal-flwl-row-', ''))
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('FLWL pure shaping', () => {
  it('the routes, and the board key the flow-worker already warms', () => {
    expect(FLOW_LISTS_CODE).toBe('FLWL')
    expect(CREAM_URL).toBe('/api/live/massive/cream')
    expect([BOARD_DAYS, BOARD_LIMIT]).toEqual([60, 300])
    expect(FLOW_BOARD_URL).toBe('/api/live/massive/flow-board?days=60&cap=all&limit=300')
    expect(stampedKey(CREAM_URL)).toEqual(['/api/live/massive/cream', 'terminal-stamped'])
  })

  it('the words a list is typed as, and the command arguments', () => {
    expect(Object.keys(FLOW_LISTS)).toEqual(['cream', 'open'])
    for (const [raw, want] of [['OPEN', 'open'], ['open', 'open'], ['Board', 'open'], ['openflow', 'open'], ['CREAM', 'cream'],
      ['top', 'cream'], [' crop ', 'cream']]) expect(parseFlowList(raw), String(raw)).toBe(want)
    for (const bad of [null, undefined, '', 'nonsense', 'toString', 'constructor', 7]) expect(parseFlowList(bad), String(bad)).toBeNull()
    expect(normFlowList('nonsense')).toBe('cream')
    expect(normFlowList(null)).toBe('cream')
    expect(normFlowList('OPEN')).toBe('open')
    expect(flowListsCommandArgs({ list: 'cream' })).toEqual([])
    expect(flowListsCommandArgs({ list: 'open' })).toEqual(['OPEN'])
    expect(flowListsCommandArgs()).toEqual([])
    // every token a chip writes is a word the reader gives back as the same list
    for (const [key, l] of Object.entries(FLOW_LISTS)) if (l.token) expect(parseFlowList(l.token)).toBe(key)
  })

  it('isoDay reads the store date and an ISO date as a calendar date, and nothing else', () => {
    expect(isoDay('11/16/2026')).toBe('2026-11-16')
    expect(isoDay('1/5/2027')).toBe('2027-01-05')
    expect(isoDay('2026-10-02')).toBe('2026-10-02')
    expect(isoDay('2026-10-02T14:30:00+00:00')).toBe('2026-10-02')
    for (const bad of [null, undefined, '', 'yesterday', '13/40/2026', '2026-13-01', 20261116, '11-16-2026']) expect(isoDay(bad), String(bad)).toBeNull()
  })

  it('optionSide, contractText and directionWords say a contract and a direction in plain words', () => {
    expect([optionSide('C'), optionSide('p'), optionSide('CALL'), optionSide('Put'), optionSide(''), optionSide(null), optionSide('X')])
      .toEqual(['call', 'put', 'call', 'put', null, null, null])
    expect(contractText({ side: 'call', strike: 420, expiry: '2026-12-18' })).toBe('$420 call, expires 2026-12-18')
    expect(contractText({ side: 'put', strike: 27.5, expiry: '2027-01-15' })).toBe('$27.50 put, expires 2027-01-15')
    expect(contractText({ side: 'call', strike: null, expiry: null })).toBe('call')
    expect(contractText({ side: null, strike: null, expiry: null })).toBe('Not given')
    expect(contractText(null)).toBe('Not given')
    expect(directionWords({ direction: 'bullish' })).toBe('Bullish')
    expect(directionWords({ direction: 'bearish', unconfirmed: true })).toBe('Bearish, side not confirmed')
    expect(directionWords({ direction: null })).toBe('Not given')
    expect(directionWords(undefined)).toBe('Not given')
  })

  it('creamRead: bullish first then bearish, each in the server\'s order, with the contract and the numbers', () => {
    const out = creamRead(CREAM)
    expect(out.state).toBe('ok')
    expect(out.date).toBe('2026-11-16')
    expect(out.rows.map((r) => [r.sym, r.direction, r.side, r.strike, r.expiry])).toEqual([
      ['AAA', 'bullish', 'call', 420, '2026-12-18'], ['BBB', 'bullish', 'call', 27.5, '2027-01-15'], ['CCC', 'bearish', 'put', 150, '2027-03-19'],
    ])
    expect(out.rows.map((r) => r.order)).toEqual([0, 1, 2])
    expect(out.rows.map((r) => r.premium)).toEqual([2240000, 1100000, 3500000])
    expect(out.rows.map((r) => [r.contracts, r.openInterest, r.volToOi, r.newStrike])).toEqual([
      [5300, 1200, 4.4, false], [900, 0, null, true], [2100, 800, 2.6, false],
    ])
    expect(out.rows.map((r) => [r.grade, r.daysLeft, r.unconfirmed, r.tier])).toEqual([
      ['A', 32, false, 'alpha'], ['B', 60, true, 'size'], ['A+', 123, false, 'alpha_leaps'],
    ])
    expect(new Set(out.rows.map((r) => r.key)).size).toBe(3)
    expect(out.counts).toEqual({ all: 3, bullish: 2, bearish: 1 })
    expect(out.net).toEqual({ bull: 812000000, bear: 640000000 })
    expect(out.twoSided).toEqual([{ sym: 'DDD', bull: 6100000, bear: 10000000 }])
    expect(out.rules).toEqual({ perSide: 12, perStock: 2, minDays: 7, noWeeklies: true, noBlockOnly: true, minGrade: 'C' })
  })

  it('creamRead: no rows is a healthy answer, a row with no ticker is dropped, a missing ratio is not a new strike', () => {
    const empty = creamRead(CREAM_EMPTY)
    expect(empty).toMatchObject({ state: 'ok', date: '2026-11-16', rows: [], counts: { all: 0, bullish: 0, bearish: 0 } })
    const odd = creamRead({ date: 'soon', bull: [{ cp: 'C', strike: 10 }, null, { sym: 'EEE', cp: 'C', strike: 0, exp: 'later', vol: 50, oi: 400, voi: null }], bear: [] })
    expect(odd.date).toBeNull()
    expect(odd.rows.map((r) => [r.sym, r.strike, r.expiry, r.newStrike, r.volToOi, r.grade])).toEqual([['EEE', null, null, false, null, null]])
    expect(odd.net).toBeNull()
    expect(odd.rules).toEqual({ perSide: null, perStock: null, minDays: null, noWeeklies: null, noBlockOnly: null, minGrade: null })
  })

  it('creamRead: anything that is not the route\'s shape is a failed read, never an empty list', () => {
    for (const body of [undefined, null, [], 'x', {}, { bull: [] }, { bull: 'none', bear: [] }, { detail: 'This data requires a paid plan' }, COMPUTING]) {
      const out = creamRead(body)
      expect(out.state, JSON.stringify(body)).toBe('failed')
      expect(out.rows).toEqual([])
    }
  })

  // The route never computes on the request (measured 2026-11-17: a cold mid-session build did
  // not answer in 120 s). It says it is building, or hands over the list it holds with when it
  // was built and whether a rebuild is running.
  it('creamRead: the server\'s "still building" answer is its own state, never a failed read or an empty day', () => {
    const out = creamRead({ status: 'computing', date: '11/16/2026' })
    expect(out.state).toBe('computing')
    expect(out.date).toBe('2026-11-16')
    expect(out.rows).toEqual([])
    // a list beside the word is still a list: the status alone decides
    expect(creamRead({ ...CREAM, status: 'ok' }).state).toBe('ok')
  })

  it('creamRead: when the list was built, and whether the server is rebuilding it', () => {
    expect(creamRead(CREAM)).toMatchObject({ builtAt: null, stale: false })
    const built = creamRead({ ...CREAM, built_at: 1794846600 })
    expect(built.builtAt).toBe(new Date(1794846600 * 1000).toISOString())
    expect(built.stale).toBe(false)
    expect(creamRead({ ...CREAM, built_at: 1794846600, stale: true }).stale).toBe(true)
    for (const odd of [0, -5, 'soon', null, true]) expect(creamRead({ ...CREAM, built_at: odd }).builtAt, String(odd)).toBeNull()
    expect(creamRead({ ...CREAM, stale: 'yes' }).stale).toBe(false)
  })

  it('boardRead: one row per stock, biggest net premium first in either direction, the share as the percent sent', () => {
    const out = boardRead(BOARD)
    expect(out.state).toBe('ok')
    expect(out.rows.map((r) => [r.sym, r.direction, r.net])).toEqual([['CCC', 'bearish', -9500000], ['AAA', 'bullish', 4400000], ['BBB', 'bullish', 1200000]])
    expect(out.rows.map((r) => r.order)).toEqual([0, 1, 2])
    // `bullPct` is already a percent (0 to 100) on this route: never multiplied again
    expect(out.rows.map((r) => r.bullShare)).toEqual([4, 87, 83])
    expect(out.rows.map((r) => [r.bull, r.bear])).toEqual([[400000, 9900000], [5200000, 800000], [1500000, 300000]])
    expect(out.rows.map((r) => [r.side, r.strike, r.expiry, r.daysLeft])).toEqual([['put', 150, '2027-03-19', 123], ['call', 420, '2026-12-18', 32], ['call', 27.5, '2027-01-15', 60]])
    expect(out.rows.map((r) => [r.since, r.stockPct])).toEqual([['2026-09-21', -11.2], ['2026-10-02', 6.4], ['2026-11-03', null]])
    expect(out).toMatchObject({ names: 3, openContracts: 41, days: 60, minDays: 30 })
    expect(out.builtAt).toBe(new Date(1794836400123).toISOString())
    // a stock sent twice is one row; a row with no ticker is dropped; a tie keeps the order sent
    const odd = boardRead({ ok: true, rows: [{ sym: 'aaa', net: 5 }, { sym: 'AAA', net: 900 }, { net: 3 }, null, { sym: 'ZZZ', net: -5 }] })
    expect(odd.rows.map((r) => [r.sym, r.net, r.direction])).toEqual([['AAA', 5, 'bullish'], ['ZZZ', -5, 'bearish']])
    expect(odd).toMatchObject({ names: null, openContracts: null, builtAt: null })
  })

  it('boardRead: building, could not build and not-a-board are three states, none of them an empty list', () => {
    expect(boardRead(COMPUTING)).toMatchObject({ state: 'computing', rows: [] })
    expect(boardRead({ ok: false, reason: 'Computing', rows: [] }).state).toBe('computing')
    expect(boardRead(BUILD_FAILED)).toMatchObject({ state: 'unavailable', rows: [] })
    expect(boardRead({ ok: false }).state).toBe('unavailable')
    for (const body of [undefined, null, [], 'x', {}, { rows: [] }, { ok: true }, { ok: true, rows: 'none' }, CREAM]) {
      expect(boardRead(body).state, JSON.stringify(body)).toBe('failed')
    }
    expect(boardRead({ ...BOARD, rows: [] })).toMatchObject({ state: 'ok', rows: [], names: 3 })
  })
})

describe('FLWL Cream of the Crop states', () => {
  it('shows a loading skeleton, and asks only for the list on screen', () => {
    serve({ [CREAM_URL]: PENDING })
    renderPanel()
    expect(screen.getByTestId('terminal-flwl-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-flwl-cream')).toBeNull()
    expect(asked()).toEqual([CREAM_URL])
  })

  it('a failed read (500) is an error with Retry, never an empty list', async () => {
    serve({})
    renderPanel({}, { code: 'FLWX' })
    const err = await screen.findByTestId('terminal-flwl-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The Cream of the Crop list could not be read just now.')
    expect(err.textContent).toContain('That is not the same as an empty list. Retry, or run FLWX again.')
    expect(screen.queryByTestId('terminal-flwl-empty')).toBeNull()
    serve({ [CREAM_URL]: CREAM })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-flwl-cream')).toBeTruthy()
  })

  it('a 402 says paid plan and a 404 says not switched on, both locked with no Retry', async () => {
    serve({ [CREAM_URL]: fail(402) })
    renderPanel()
    const paid = await screen.findByTestId('terminal-flwl-error')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(paid.textContent).toContain('The Cream of the Crop list needs a paid plan.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    serve({ [CREAM_URL]: fail(404) })
    renderPanel()
    const off = await screen.findByTestId('terminal-flwl-error')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('The Cream of the Crop list is not switched on for this server yet.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('a 401 says signed out', async () => {
    serve({ [CREAM_URL]: fail(401) })
    renderPanel()
    const out = await screen.findByTestId('terminal-flwl-error')
    expect(out.textContent).toContain('You are signed out, so the Cream of the Crop list cannot be read. Sign in again.')
    expect(screen.queryByTestId('terminal-flwl-empty')).toBeNull()
  })

  it('an answer that is not the route\'s shape is an error, not an empty list', async () => {
    serve({ [CREAM_URL]: { detail: 'upstream said something else' } })
    renderPanel()
    const err = await screen.findByTestId('terminal-flwl-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The Cream of the Crop list could not be read just now.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-flwl-empty')).toBeNull()
  })

  it('a healthy answer with no rows says nothing has qualified, for which date, and can be checked again', async () => {
    serve({ [CREAM_URL]: CREAM_EMPTY })
    const { setFreshness } = renderPanel()
    const empty = await screen.findByTestId('terminal-flwl-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No option position has qualified for 2026-11-16 yet.')
    expect(empty.textContent).toContain('Before the open, on a weekend and on a market holiday it stays empty until the next session trades.')
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    serve({ [CREAM_URL]: CREAM })
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByTestId('terminal-flwl-cream')).toBeTruthy()
  })

  it('"computing" says the server is building the list: not empty, not an error, no time', async () => {
    serve({ [CREAM_URL]: { status: 'computing', date: '11/16/2026' } })
    const { setFreshness } = renderPanel()
    const building = await screen.findByTestId('terminal-flwl-cream-building')
    expect(building.getAttribute('data-kind')).toBe('empty')
    expect(building.getAttribute('role')).toBe('status')
    expect(building.textContent).toContain('Loading, the server is preparing this.')
    expect(building.textContent).toContain('This panel asks again every 20 seconds and fills in on its own.')
    expect(building.textContent).toContain('That is not the same as no positions.')
    expect(screen.queryByTestId('terminal-flwl-empty')).toBeNull()
    expect(screen.queryByTestId('terminal-flwl-error')).toBeNull()
    expect(screen.queryByTestId('terminal-flwl-cream')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
  })

  it('a list the server is rebuilding is shown with a note, and the header carries when it was built', async () => {
    serve({ [CREAM_URL]: { ...CREAM, built_at: 1794846600, stale: true } })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-flwl-cream')
    expect(screen.getByTestId('terminal-flwl-cream-stale').textContent).toContain('The server is rebuilding this list now.')
    const reports = setFreshness.mock.calls.map(([report]) => report).filter(Boolean)
    expect(JSON.stringify(reports[reports.length - 1])).toContain(new Date(1794846600 * 1000).toISOString())
    cleanup()
    // a fresh build carries no note
    serve({ [CREAM_URL]: { ...CREAM, built_at: 1794846600 } })
    renderPanel()
    await screen.findByTestId('terminal-flwl-cream')
    expect(screen.queryByTestId('terminal-flwl-cream-stale')).toBeNull()
  })
})

describe('FLWL Cream of the Crop, populated', () => {
  it('lists every position with its contract, direction, premium and what the list is about', async () => {
    serve({ [CREAM_URL]: CREAM })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-flwl-cream')
    expect(symsIn('terminal-flwl-cream')).toEqual(['AAA', 'BBB', 'CCC'])
    const cells = rowsOf('terminal-flwl-cream').map((r) => r.textContent)
    for (const s of ['1', 'AAA', '$420 call, expires 2026-12-18', 'Bullish', '$2.2M', 'A', '4.4×', '5,300', '32']) expect(cells[0]).toContain(s)
    for (const s of ['2', 'BBB', '$27.50 call, expires 2027-01-15', 'Bullish, side not confirmed', '$1.1M', 'New strike', '900', '60']) expect(cells[1]).toContain(s)
    for (const s of ['3', 'CCC', '$150 put, expires 2027-03-19', 'Bearish', '$3.5M', 'A+', '2.6×', '2,100', '123']) expect(cells[2]).toContain(s)
    expect(screen.getByRole('table', { name: 'Cream of the Crop for 2026-11-16, 3 positions' })).toBeTruthy()
    expect(screen.getByTestId('terminal-flwl-totals').textContent)
      .toBe('2 bullish and 1 bearish positions for 2026-11-16. Across the whole market that day: $812.0M of bullish premium and $640.0M of bearish premium.')
    expect(screen.getByTestId('terminal-flwl-two-sided').textContent).toBe("Left out because the day's flow went both ways: DDD.")
    // the header: the source and the session the server names, as a calendar date
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE, age: { asOfDate: '2026-11-16' } }))
    const method = screen.getByTestId('terminal-flwl-method').textContent
    expect(method).toContain('ranked by grade and then by premium. At most 12 per side and 2 per stock.')
    expect(method).toContain('Index options are left out, and so are weekly expiries and contracts with under 7 days to expiry.')
    expect(method).toContain('it is not a forecast or a recommendation.')
    expect(method).toMatch(/Read at \d{1,2}:\d{2} [AP]M ET\./)
    expect(document.body.textContent).not.toMatch(/[—–]/)
    expect(asked().every((url) => url === CREAM_URL)).toBe(true)
  })

  it('the method sentence follows the rules the server sent, not a fixed wording', async () => {
    serve({ [CREAM_URL]: { ...CREAM, params: { ...CREAM.params, exclude_weekly: false, min_dte: 0 } } })
    renderPanel()
    await screen.findByTestId('terminal-flwl-cream')
    const method = screen.getByTestId('terminal-flwl-method').textContent
    expect(method).toContain('Index options are left out. ')
    expect(method).not.toContain('weekly expiries')
    expect(method).not.toContain('days to expiry')
    cleanup()
    serve({ [CREAM_URL]: { ...CREAM, params: undefined, net: null, two_sided: [] } })
    renderPanel()
    await screen.findByTestId('terminal-flwl-cream')
    expect(screen.getByTestId('terminal-flwl-method').textContent).not.toContain('At most')
    expect(screen.getByTestId('terminal-flwl-totals').textContent).toBe('2 bullish and 1 bearish positions for 2026-11-16.')
    expect(screen.queryByTestId('terminal-flwl-two-sided')).toBeNull()
  })

  it('a symbol loads into the linked panels, and the numbered rows are the rows on screen', async () => {
    serve({ [CREAM_URL]: CREAM })
    const { run, publishRows } = renderPanel()
    await screen.findByTestId('terminal-flwl-cream')
    fireEvent.click(screen.getByTestId('panel-symbol-CCC'))
    expect(run).toHaveBeenCalledWith('$CCC')
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC'])
  })
})

describe('FLWL open flow board', () => {
  it('the list prop seeds the chip, and only the board is read', async () => {
    serve({ [FLOW_BOARD_URL]: BOARD })
    const { setFreshness } = renderPanel({ list: 'OPEN' })
    await screen.findByTestId('terminal-flwl-open')
    expect(screen.getByTestId('terminal-flwl').getAttribute('data-list')).toBe('open')
    expect(asked().every((url) => url === FLOW_BOARD_URL)).toBe(true)
    // biggest net premium first, in either direction
    expect(symsIn('terminal-flwl-open')).toEqual(['CCC', 'AAA', 'BBB'])
    const cells = rowsOf('terminal-flwl-open').map((r) => r.textContent)
    // the first-trade date is written with hyphens that never break a line (U+2011), so it stays whole in a narrow cell
    for (const s of ['1', 'CCC', '$150 put, expires 2027-03-19', 'Bearish', '-$9.5M', '$400K', '$9.9M', '4%', '2026‑09‑21', '-11.2%']) expect(cells[0]).toContain(s)
    expect(cells[0]).toContain('$400K / $9.9M')          // bullish then bearish premium share one column
    expect(cells[0]).toContain('since 2026‑09‑21')
    for (const s of ['2', 'AAA', '$420 call, expires 2026-12-18', 'Bullish', '+$4.4M', '$5.2M', '$800K', '87%', '2026‑10‑02', '+6.4%']) expect(cells[1]).toContain(s)
    for (const s of ['3', 'BBB', '+$1.2M', '83%', '2026‑11‑03', 'n/a']) expect(cells[2]).toContain(s)
    // a share the server sends as 87 is 87%, never 8700%
    expect(document.body.textContent).not.toContain('8700%')
    expect(screen.getByTestId('terminal-flwl-totals').textContent)
      .toBe('3 stocks with open positions: 2 leaning bullish, 1 leaning bearish, across 41 open contracts.')
    expect(screen.queryByTestId('terminal-flwl-cut')).toBeNull()
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, observedAt: new Date(1794836400123).toISOString() })))
    const method = screen.getByTestId('terminal-flwl-method').textContent
    expect(method).toContain('from the last 60 trading days that are still open, biggest net premium first in either direction.')
    expect(method).toContain('Only contracts with at least 30 days to expiry when traded are counted.')
    expect(method).toMatch(/Board built at \d{1,2}:\d{2} [AP]M ET\./)
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('"computing" says the server is building the board: not empty, not an error', async () => {
    serve({ [FLOW_BOARD_URL]: COMPUTING })
    const { setFreshness } = renderPanel({ list: 'open' })
    const building = await screen.findByTestId('terminal-flwl-building')
    expect(building.getAttribute('data-kind')).toBe('empty')
    expect(building.getAttribute('role')).toBe('status')
    expect(building.textContent).toContain('Loading, the server is preparing this.')
    expect(building.textContent).toContain('This panel asks again every 20 seconds and fills in on its own.')
    expect(building.textContent).toContain('That is not the same as no open positions.')
    expect(screen.queryByTestId('terminal-flwl-empty')).toBeNull()
    expect(screen.queryByTestId('terminal-flwl-error')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
  })

  it('a board the server could not build is an error with Retry, and its raw reason is never printed', async () => {
    serve({ [FLOW_BOARD_URL]: BUILD_FAILED })
    renderPanel({ list: 'open' }, { code: 'FLWX' })
    const err = await screen.findByTestId('terminal-flwl-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The server could not build the open flow board just now.')
    expect(err.textContent).toContain('That is not the same as no open positions. Retry, or run FLWX again.')
    expect(document.body.textContent).not.toContain('database is locked')
    expect(screen.queryByTestId('terminal-flwl-empty')).toBeNull()
    serve({ [FLOW_BOARD_URL]: BOARD })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-flwl-open')).toBeTruthy()
  })

  it('a failed read (500), signed out (401) and locked (402, 404) each say so', async () => {
    serve({})
    renderPanel({ list: 'open' })
    const err = await screen.findByTestId('terminal-flwl-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The open flow board could not be read just now.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    for (const [status, kind, words] of [
      [401, 'error', 'You are signed out, so the open flow board cannot be read. Sign in again.'],
      [402, 'locked', 'The open flow board needs a paid plan.'],
      [404, 'locked', 'The open flow board is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve({ [FLOW_BOARD_URL]: fail(status) })
      renderPanel({ list: 'open' })
      const state = await screen.findByTestId('terminal-flwl-error')
      expect(state.getAttribute('data-kind'), String(status)).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), String(status)).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-flwl-empty')).toBeNull()
    }
  })

  it('a healthy board with no rows says no stock has open positions, and an odd answer is an error', async () => {
    serve({ [FLOW_BOARD_URL]: { ...BOARD, rows: [], n_names: 0, open_contracts: 0 } })
    renderPanel({ list: 'open' })
    const empty = await screen.findByTestId('terminal-flwl-empty')
    expect(empty.textContent).toContain('No stock has open directional option positions from the last 60 trading days.')
    cleanup()
    serve({ [FLOW_BOARD_URL]: { rows: [] } })
    renderPanel({ list: 'open' })
    const err = await screen.findByTestId('terminal-flwl-error')
    expect(err.textContent).toContain('The open flow board could not be read just now.')
    expect(screen.queryByTestId('terminal-flwl-empty')).toBeNull()
  })

  it('says when the server cut the list, and draws a long board a hundred at a time', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ sym: `T${String(i).padStart(3, '0')}`, bull: 2000000 - i * 1000, bear: 100000, net: 1900000 - i * 1000, bullPct: 95, cp: 'C', strike: 50, exp: '12/18/2026', dte: 32, since: '2026-10-02', perf: 1.5 }))
    serve({ [FLOW_BOARD_URL]: { ...BOARD, rows: many, n_names: 412 } })
    const { publishRows } = renderPanel({ list: 'open' })
    await screen.findByTestId('terminal-flwl-open')
    expect(screen.getByTestId('terminal-flwl-cut').textContent)
      .toBe('The server sends the 120 stocks with the highest net premium of 412, so the most bearish names can be missing from this list.')
    expect(rowsOf('terminal-flwl-open')).toHaveLength(MAX_ROWS)
    expect(screen.getByTestId('terminal-flwl-method').textContent).toContain('Showing the 100 biggest of 120. ')
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(100)
    fireEvent.click(screen.getByTestId('terminal-flwl-all'))
    expect(rowsOf('terminal-flwl-open')).toHaveLength(120)
    expect(screen.getByTestId('terminal-flwl-all').textContent).toBe('Show the first 100')
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(120)
  })
})

describe('FLWL chips', () => {
  it('the chips switch the list, each list read only once it is on screen', async () => {
    serve({ [CREAM_URL]: CREAM, [FLOW_BOARD_URL]: BOARD })
    const { rerun, publishRows } = renderPanel()
    await screen.findByTestId('terminal-flwl-cream')
    expect(screen.getByTestId('terminal-flwl-list-cream').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-flwl-list-open').getAttribute('aria-pressed')).toBe('false')
    expect(asked()).not.toContain(FLOW_BOARD_URL)
    fireEvent.click(screen.getByTestId('terminal-flwl-list-open'))
    await screen.findByTestId('terminal-flwl-open')
    expect(screen.getByTestId('terminal-flwl-list-open').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('terminal-flwl-cream')).toBeNull()
    expect(asked()).toContain(FLOW_BOARD_URL)
    await waitFor(() => expect(publishRows).toHaveBeenLastCalledWith(['$CCC', '$AAA', '$BBB']))
    fireEvent.click(screen.getByTestId('terminal-flwl-list-cream'))
    expect(await screen.findByTestId('terminal-flwl-cream')).toBeTruthy()
    // outside a registered panel nothing is written back: the chip is plain component state
    expect(rerun).not.toHaveBeenCalled()
  })

  it('inside a panel whose code does not take the word, the chip still switches and writes nothing', async () => {
    // MOST is a registered code whose market variant takes UP and DOWN, not OPEN.
    serve({ [CREAM_URL]: CREAM, [FLOW_BOARD_URL]: BOARD })
    const { rerun } = renderPanel({}, { code: 'MOST' })
    await screen.findByTestId('terminal-flwl-cream')
    fireEvent.click(screen.getByTestId('terminal-flwl-list-open'))
    expect(await screen.findByTestId('terminal-flwl-open')).toBeTruthy()
    expect(rerun).not.toHaveBeenCalled()
    // back to the default list is the bare command, which every code takes
    fireEvent.click(screen.getByTestId('terminal-flwl-list-cream'))
    expect(rerun).toHaveBeenLastCalledWith('MOST')
  })
})

describe('FLWL follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['FlowListsPanel.jsx', 'flowListsModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('FLWL accessibility', () => {
  it('both lists pass axe (WCAG A and AA)', async () => {
    serve({ [CREAM_URL]: CREAM, [FLOW_BOARD_URL]: BOARD })
    renderPanel()
    await screen.findByTestId('terminal-flwl-cream')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-flwl-list-open'))
    await screen.findByTestId('terminal-flwl-open')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})
