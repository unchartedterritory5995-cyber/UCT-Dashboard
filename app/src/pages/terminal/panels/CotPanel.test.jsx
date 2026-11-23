// COT: futures positioning from the CFTC's weekly Commitments of Traders report. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan and an answer that is not
//     the route's shape: none is "no positions";
//   * the board: one row per market the server lists (each once), largest weekly move first, a market
//     that fails NAMED and never dropped, at most four requests in flight, a Retry that re-asks only
//     what failed, no all-markets route and no status call;
//   * one market: each class's net with the week's change, the 3-year range only with its reports,
//     the last eight reports, the report's own date as the as-of, the weekly sentence;
//   * every plain word and every code opens its market; an unknown word says so;
//   * the stored note is read, labelled with its own report date, and never asked for;
//   * the picker and a row click write the market into the command;
//   * no position is called bullish or bearish; no hard-coded color; axe.
//   * by trader type (the CFTC's TFF and Disaggregated reports): one market's "By trader type" table below the
//     classes table, with each class's net, sides, share and range, its own report date and the credit; every
//     state; the board's funds column from ONE read, never waited for, each cell naming its class.
// Every number, name and note is invented; the fixtures are the routes' real shapes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, act, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { SWRConfig, useSWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import CotPanel from './CotPanel'
import { COT_CODE, COT_SOURCE, COT_WEEKLY_LINE, COT_WORDS } from './cotModel'
import { clearCotBoardCache } from './useCotBoard'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SYMBOLS_URL = '/api/cot/symbols'
const rowsUrl = (code) => `/api/cot/${code}?weeks=160`
const noteUrl = (code) => `/api/cot/${code}/narratives?limit=1`
const FINER_BOARD_URL = '/api/cot/breakdown'
const finerUrl = (code) => `/api/cot/${code}/breakdown?weeks=160`
/** The Tuesday `back` weeks before Tue Nov 17 2026. */
const tue = (back) => new Date(Date.UTC(2026, 10, 17) - back * 7 * 86400000).toISOString().slice(0, 10)
const weekly = (n, f, shift = 0) => Array.from({ length: n }, (_, i) => ({ date: tue(n - 1 - i + shift), ...f(n - 1 - i) }))
/** 160 reports: large specs +180,000 (+80,000 on the week, 80 of 100), commercials -190,000 (-70,000, 30 of 100). */
const GOLD = weekly(160, (back) => ({
  large_spec_net: back === 0 ? 180000 : back % 2 ? 100000 : 200000,
  commercial_net: back === 0 ? -190000 : back % 2 ? -120000 : -220000,
  small_spec_net: back === 0 ? 10000 : back % 2 ? 20000 : 0,
  open_interest: back === 0 ? 520000 : 500000,
}))
const three = (ls, comm, oi, shift = 0) => weekly(3, (back) => ({
  large_spec_net: ls[2 - back], commercial_net: comm[2 - back], small_spec_net: 1000, open_interest: oi,
}), shift)
const CRUDE = three([90000, 60000, 20000], [-80000, -50000, -10000], 500000)          // -40,000 on the week = -8.0% of open interest
const NASDAQ = three([1000, 4000, 10000], [-2000, -5000, -12000], 300000)             // +6,000 = +2.0%
const SP = three([30000, 30000, 25000], [-20000, -20000, -15000], 2500000)            // -5,000 = -0.2%
const SILVER = three([5000, 7000, 7000], [-6000, -8000, -8000], 150000)               // unchanged = 0.0%
const TNOTE = GOLD.slice(-1)                                                          // one report: no week change
const SYMBOLS = { groups: {
  'MOST WATCHED': [{ symbol: 'ES', name: 'S&P 500 E-mini' }, { symbol: 'ZN', name: '10-Year T-Note' }],
  INDICES: [{ symbol: 'ES', name: 'S&P 500 E-mini' }, { symbol: 'NQ', name: 'Nasdaq 100 E-mini' }],
  METALS: [{ symbol: 'GC', name: 'Gold' }, { symbol: 'SI', name: 'Silver' }],
  RATES: [{ symbol: 'ZN', name: '10-Year T-Note' }],
  ENERGIES: [{ symbol: 'CL', name: 'Crude Oil' }, { symbol: 'NG', name: 'Natural Gas' }],
} }
const NOTE = { symbol: 'GC', rows: [{ report_date: '2026-11-17', text: 'Large speculators added to their net long.\n\nCommercials added to their net short.', created_at: '2026-11-20T21:40:00+00:00' }] }
/** By trader type, the board: managed money in gold (+120,000, +20,000 on the week) and crude (one week, a week
 *  older than crude's legacy row), leveraged funds in the S&P (-120,000, -30,000); the rest carry no record. */
const FINER_BOARD = {
  state: 'ok', source: 'x', watch: { tff: 'leveraged_funds', disaggregated: 'managed_money' }, reports: {},
  markets: {
    GC: { report: 'disaggregated', watch: 'managed_money', date: tue(0), open_interest: 520000, long: 150000, short: 30000, spread: 40000,
      previous: { date: tue(1), open_interest: 500000, long: 140000, short: 40000, spread: 30000 } },
    ES: { report: 'tff', watch: 'leveraged_funds', date: tue(0), open_interest: 2500000, long: 300000, short: 420000, spread: 1,
      previous: { date: tue(1), open_interest: 2500000, long: 310000, short: 400000, spread: 1 } },
    CL: { report: 'disaggregated', watch: 'managed_money', date: tue(1), open_interest: 500000, long: 50000, short: 20000, spread: 0, previous: null },
  },
  no_record: ['NQ', 'SI', 'ZN', 'NG'], next_check: '2026-11-22T21:10-05:00', building: false,
}
const DIS_KEYS = ['producer_merchant', 'swap_dealer', 'managed_money', 'other_reportable', 'nonreportable']
/** By trader type, one market: 160 weeks of gold in the Disaggregated report. Managed money +240,000 now (+80,000
 *  on the week, 80 of 100, 46.2% of open interest); the other classes hold still (50 of 100). */
const finerGold = (n = 160, shift = 0) => ({
  symbol: 'GC', state: 'ok', report: 'disaggregated', report_name: 'Disaggregated', watch: 'managed_money',
  classes: DIS_KEYS.map((key) => ({ key, cftc: key, spread: !['producer_merchant', 'nonreportable'].includes(key), traders: key !== 'nonreportable' })),
  rows: Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i
    const mm = back === 0 ? 280000 : back % 2 ? 200000 : 300000
    return {
      date: tue(back + shift), open_interest: back === 0 ? 520000 : 500000, traders_total: 300,
      classes: {
        producer_merchant: { long: 50000, short: 210000, spread: null, traders_long: 30, traders_short: 41, traders_spread: null },
        swap_dealer: { long: 20000, short: 90000, spread: 1234, traders_long: 12, traders_short: 15, traders_spread: 6 },
        managed_money: { long: mm, short: 40000, spread: 30000, traders_long: 88, traders_short: 21, traders_spread: 34 },
        other_reportable: { long: 30000, short: 31000, spread: 2000, traders_long: 40, traders_short: 22, traders_spread: 9 },
        nonreportable: { long: 45000, short: 50000, spread: null, traders_long: null, traders_short: null, traders_spread: null },
      },
    }
  }),
  records: [{ cftc_code: 'INV001', market_name: 'INVENTED METAL - INVENTED EXCHANGE', match: 'code', first: tue(n - 1 + shift), last: tue(shift) }],
  concentration: { date: tue(shift), gross_4_long: 21.7, gross_4_short: 18.0, gross_8_long: 33.1, gross_8_short: 29.4 },
  source: 'x', next_check: '2026-11-22T21:10-05:00', building: false,
})
/** Every route the board and one market read, all answering. */
const ALL = {
  [SYMBOLS_URL]: SYMBOLS,
  [rowsUrl('ES')]: SP, [rowsUrl('NQ')]: NASDAQ, [rowsUrl('GC')]: GOLD, [rowsUrl('SI')]: SILVER, [rowsUrl('ZN')]: TNOTE, [rowsUrl('CL')]: CRUDE,
  [rowsUrl('NG')]: [],
  [noteUrl('GC')]: NOTE,
  [FINER_BOARD_URL]: FINER_BOARD,
  [finerUrl('GC')]: finerGold(),
}
const BOARD_URLS = ['ES', 'NQ', 'GC', 'SI', 'ZN', 'CL', 'NG'].map(rowsUrl)

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves each route its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    const hit = routes[url]
    if (hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const calls = () => jsonFetcher.mock.calls.map(([url]) => url)
const asked = () => [...new Set(calls())]
const timesAsked = (url) => calls().filter((u) => u === url).length

/** Re-reads every key the panel holds, as a poll would (set by the mounted tree). */
let revalidateAll = async () => {}
function Revalidator() {
  const { mutate } = useSWRConfig()
  useEffect(() => { revalidateAll = () => mutate(() => true) }, [mutate])
  return null
}

function renderPanel(props = {}, { rerun = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const tree = (p) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <Revalidator />
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><CotPanel {...p} /></TerminalPanelContext.Provider>
            : <CotPanel {...p} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  const view = render(tree(props))
  return { rerun, setFreshness, rerender: (p) => view.rerender(tree(p)), container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const boardRows = () => screen.getAllByTestId('terminal-cot-board-row')
const boardCodes = () => boardRows().map((r) => r.getAttribute('data-code'))
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()
const WEEKLY_REPORT = { source: COT_SOURCE, age: { dataClass: 'weekly', asOfDate: '2026-11-17' } }
const pickMarket = (value) => fireEvent.change(screen.getByTestId('terminal-cot-market'), { target: { value } })

beforeEach(() => { jsonFetcher.mockReset(); clearCotBoardCache() })
afterEach(cleanup)

describe('COT states', () => {
  it('shows a loading skeleton and asks for the list of markets first', () => {
    serve({ [SYMBOLS_URL]: PENDING })
    renderPanel()
    expect(COT_CODE).toBe('COT')
    expect(screen.getByTestId('terminal-cot-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-cot')).toBeNull()
    expect(asked()).toEqual([SYMBOLS_URL])
  })

  it('a failed read of the list (500) is an error with Retry, never "no positions"', async () => {
    serve({})
    const { setFreshness } = renderPanel({}, { code: 'COT' })
    const err = await screen.findByTestId('terminal-cot-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Futures positioning could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no positions. Retry, or run COT again.')
    expect(screen.queryByTestId('terminal-cot-board')).toBeNull()
    expect(screen.queryByTestId('terminal-cot-none')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve(ALL)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-cot-board')).toBeTruthy()
  })

  it('signed out, a timeout and no paid plan each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so futures positioning cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'Futures positioning did not answer within 30 seconds.'],
      [fail(503), 'error', 'Futures positioning could not be read just now.'],
      [fail(402), 'locked', 'Futures positioning needs a paid plan.'],
    ]) {
      serve({ [SYMBOLS_URL]: err })
      renderPanel()
      const box = await screen.findByTestId('terminal-cot-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!within(box).queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-cot-board')).toBeNull()
      cleanup()
    }
  })

  it('an answer that is not the list\'s shape is a failed read; a list with no market says so', async () => {
    serve({ [SYMBOLS_URL]: { status: 'ok', rows: [] } })
    renderPanel()
    const err = await screen.findByTestId('terminal-cot-error')
    expect(err.textContent).toContain('Futures positioning could not be read just now.')
    expect(screen.queryByTestId('terminal-cot-none')).toBeNull()
    cleanup()
    serve({ [SYMBOLS_URL]: { groups: {} } })
    renderPanel()
    expect((await screen.findByTestId('terminal-cot-none')).textContent).toContain('The server lists no futures market.')
    expect(screen.queryByTestId('terminal-cot-error')).toBeNull()
  })
})

describe('COT the board', () => {
  it('reads each listed market once, from the routes the COT Data page uses, and nothing else', async () => {
    serve(ALL)
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    expect(asked().sort()).toEqual([SYMBOLS_URL, FINER_BOARD_URL, ...BOARD_URLS].sort())
    for (const url of BOARD_URLS) expect(timesAsked(url), url).toBe(1)       // ES and ZN sit on the shortlist too: still one read each
    expect(timesAsked(FINER_BOARD_URL)).toBe(1)                              // by trader type: one read for every market
    // no status call (it can start a refresh on the server), no note, and nothing but a GET
    expect(calls().some((u) => /status|narrative|refresh/.test(u))).toBe(false)
    for (const [, init] of jsonFetcher.mock.calls) expect(init?.method ?? 'GET').toBe('GET')
  })

  it('keeps at most four market reads in flight', async () => {
    let inFlight = 0
    let most = 0
    jsonFetcher.mockImplementation((url) => {
      if (url === SYMBOLS_URL || url === FINER_BOARD_URL) return Promise.resolve(ALL[url])
      inFlight += 1
      most = Math.max(most, inFlight)
      return new Promise((resolve) => { setTimeout(() => { inFlight -= 1; resolve(ALL[url]) }, 5) })
    })
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    expect(most).toBe(4)
    expect(asked()).toHaveLength(9)
  })

  it('one row per market, largest weekly move first, a market with no week change last', async () => {
    serve(ALL)
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-cot-board')
    expect(screen.getByTestId('terminal-cot').getAttribute('data-state')).toBe('board')
    expect(boardCodes()).toEqual(['GC', 'CL', 'NQ', 'ES', 'SI', 'ZN'])
    expect(screen.getByTestId('terminal-cot-asof').textContent).toBe('Report of Tue Nov 17, 2026. 6 markets, largest weekly move first.')
    expect(screen.getByTestId('terminal-cot-weekly').textContent).toBe(COT_WEEKLY_LINE)
    // the report is set in an effect; with the funds read resolving beside the board it can land a tick later
    await waitFor(() => expect(lastReport(setFreshness)).toEqual(WEEKLY_REPORT))
    expect([...screen.getByTestId('terminal-cot-board').querySelectorAll('thead th')].map((th) => th.textContent))
      .toEqual(['Market', 'Large specs, net', 'Commercials, net', "Week's move", '3-year range', 'Funds, net'])
  })

  it('each row: the market and its code, both nets over the week\'s change, the move as a share of open interest, the range', async () => {
    serve(ALL)
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    const cells = (i) => [...boardRows()[i].querySelectorAll('td')].map((td) => td.textContent)
    // the last cell is the funds column (by trader type): the watched class's net, its week's change and its name
    expect(cells(0)).toEqual(['GoldGC', '+180.0K+80.0K on the week', '-190.0K-70.0K on the week', '+15.4%', '80', '+120.0K+20.0K on the weekManaged money'])
    expect(cells(1)).toEqual(['Crude OilCL', '+20.0K-40.0K on the week', '-10.0K+40.0K on the week', '-8.0%', 'n/a', '+30.0Kno earlier reportManaged money'])
    // a funds figure from another week than its row is named once above the board, and in its cell's title
    expect(screen.getByTestId('terminal-cot-funds-dates').textContent)
      .toBe("The funds column is from another week's report for Crude Oil (CL), report of Tue Nov 10, 2026.")
    expect(within(boardRows()[1]).getByTestId('terminal-cot-board-funds').getAttribute('title')).toBe('Report of Tue Nov 10, 2026.')
    expect(within(boardRows()[0]).getByTestId('terminal-cot-board-funds').getAttribute('title')).toBeNull()
    expect(cells(2)).toEqual(['Nasdaq 100 E-miniNQ', '+10.0K+6,000 on the week', '-12.0K-7,000 on the week', '+2.0%', 'n/a', 'n/a'])
    expect(cells(3)).toEqual(['S&P 500 E-miniES', '+25.0K-5,000 on the week', '-15.0K+5,000 on the week', '-0.2%', 'n/a', '-120.0K-30.0K on the weekLeveraged funds'])
    expect(cells(4)).toEqual(['SilverSI', '+7,0000 on the week', '-8,0000 on the week', '0.0%', 'n/a', 'n/a'])
    // one report: no week change and no move, said in words, never a 0
    expect(cells(5)).toEqual(['10-Year T-NoteZN', '+180.0Kno earlier report', '-190.0Kno earlier report', 'n/a', 'n/a', 'n/a'])
    expect(within(boardRows()[1]).getByTestId('terminal-cot-board-range').getAttribute('title')).toBe('The 3-year range needs 156 weekly reports; 3 are stored.')
  })

  it('green and red follow the sign of each number, and zero has neither', async () => {
    serve(ALL)
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    const span = (i, id) => within(boardRows()[i]).getByTestId(id).querySelector('span')
    expect(span(0, 'terminal-cot-board-large').className).toMatch(/up/)
    expect(span(0, 'terminal-cot-board-comm').className).toMatch(/down/)
    expect(span(0, 'terminal-cot-board-move').className).toMatch(/up/)
    expect(span(1, 'terminal-cot-board-move').className).toMatch(/down/)
    expect(span(4, 'terminal-cot-board-move').className).not.toMatch(/up|down/)
  })

  it('a market with no stored report is named under the list, never drawn as a row of zeros', async () => {
    serve(ALL)
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    expect(screen.getByTestId('terminal-cot-empty-markets').textContent).toBe('No report is stored yet for Natural Gas (NG).')
    expect(boardCodes()).not.toContain('NG')
    expect(screen.queryByTestId('terminal-cot-failed')).toBeNull()
  })

  it('a market whose read fails is NAMED, the rest still draw, and Retry asks again only for what failed', async () => {
    serve({ ...ALL, [rowsUrl('NG')]: fail(500), [rowsUrl('SI')]: fail(503) })
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    expect(boardCodes()).toEqual(['GC', 'CL', 'NQ', 'ES', 'ZN'])
    expect(screen.getByTestId('terminal-cot-failed').textContent).toContain('Could not read Silver (SI) and Natural Gas (NG) just now, so they are not in the list.')
    expect(screen.getByTestId('terminal-cot-asof').textContent).toContain('5 markets')
    serve(ALL)
    fireEvent.click(screen.getByTestId('terminal-cot-retry'))
    await waitFor(() => expect(boardCodes()).toEqual(['GC', 'CL', 'NQ', 'ES', 'SI', 'ZN']))
    expect(screen.queryByTestId('terminal-cot-failed')).toBeNull()
    expect([timesAsked(rowsUrl('GC')), timesAsked(rowsUrl('CL')), timesAsked(rowsUrl('SI')), timesAsked(rowsUrl('NG'))]).toEqual([1, 1, 2, 2])
  })

  it('one failed market reads "it is", not "they are"', async () => {
    serve({ ...ALL, [rowsUrl('CL')]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    expect(screen.getByTestId('terminal-cot-failed').textContent).toContain('Could not read Crude Oil (CL) just now, so it is not in the list.')
  })

  it('every market failing is the read failing: an error with Retry, or a paid-plan lock, never an empty board', async () => {
    serve({ [SYMBOLS_URL]: SYMBOLS })
    const { setFreshness } = renderPanel({}, { code: 'COT' })
    const err = await screen.findByTestId('terminal-cot-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Futures positioning could not be read just now.')
    expect(screen.queryByTestId('terminal-cot-board')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve(ALL)
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-cot-board')).toBeTruthy()
    cleanup()
    clearCotBoardCache()
    serve({ [SYMBOLS_URL]: SYMBOLS, ...Object.fromEntries(BOARD_URLS.map((u) => [u, fail(402)])) })
    renderPanel()
    const locked = await screen.findByTestId('terminal-cot-error')
    expect(locked.getAttribute('data-kind')).toBe('locked')
    expect(locked.textContent).toContain('Futures positioning needs a paid plan.')
    expect(within(locked).queryByRole('button')).toBeNull()
  })

  it('no report stored for any market says so, and is not an error', async () => {
    serve({ [SYMBOLS_URL]: SYMBOLS, ...Object.fromEntries(BOARD_URLS.map((u) => [u, []])) })
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-cot-none')
    expect(box.textContent).toContain('No report is stored for any market yet.')
    expect(screen.queryByTestId('terminal-cot-error')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
  })

  it('a market whose newest report is older is named, and its row carries its own report date', async () => {
    serve({ ...ALL, [rowsUrl('SI')]: three([5000, 7000, 9000], [-6000, -8000, -9000], 150000, 1) })
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    expect(screen.getByTestId('terminal-cot-behind').textContent).toBe('The newest stored report is older for Silver (SI): each row names its own report date.')
    const silver = boardRows().find((r) => r.getAttribute('data-code') === 'SI')
    expect(silver.querySelector('td').textContent).toBe('SilverSI, report of Tue Nov 10, 2026')
    expect(screen.getByTestId('terminal-cot-asof').textContent).toContain('Report of Tue Nov 17, 2026.')
  })

  it('the group chips are the server\'s own groups and filter the list; the shortlist is a filter, not extra rows', async () => {
    serve(ALL)
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    const group = screen.getByRole('group', { name: 'Which markets' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Most watched', 'Indices', 'Metals', 'Rates', 'Energies'])
    expect(within(group).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(group).getByRole('button', { name: 'Metals' }))
    expect(boardCodes()).toEqual(['GC', 'SI'])
    expect(within(group).getByRole('button', { name: 'Metals' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Futures positioning by market, Metals, largest weekly move first')).toBeTruthy()
    fireEvent.click(within(group).getByRole('button', { name: 'Most watched' }))
    expect(boardCodes()).toEqual(['ES', 'ZN'])
    fireEvent.click(within(group).getByRole('button', { name: 'All' }))
    expect(boardCodes()).toHaveLength(6)
    expect(asked()).toHaveLength(9)                     // a filter is not a new read
  })

  it('a group with no stored report says so', async () => {
    serve({ ...ALL, [SYMBOLS_URL]: { groups: { ...SYMBOLS.groups, ENERGIES: [{ symbol: 'NG', name: 'Natural Gas' }], OTHER: [{ symbol: 'CL', name: 'Crude Oil' }] } } })
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    fireEvent.click(screen.getByRole('button', { name: 'Energies' }))
    expect(screen.getByTestId('terminal-cot-group-empty').textContent).toBe('No market in Energies has a stored report.')
    expect(screen.queryAllByTestId('terminal-cot-board-row')).toHaveLength(0)
  })

  it('clicking a market opens it and, inside the terminal, writes it into the panel\'s own command', async () => {
    serve(ALL)
    const { rerun } = renderPanel({}, { code: 'COT' })
    await screen.findByTestId('terminal-cot-board')
    fireEvent.click(screen.getByRole('button', { name: 'Open Gold (GC)' }))
    expect(rerun).toHaveBeenLastCalledWith('COT GC')
    await screen.findByTestId('terminal-cot-classes')
    expect(screen.getByTestId('terminal-cot').getAttribute('data-market')).toBe('GC')
    fireEvent.click(screen.getByTestId('terminal-cot-back'))
    expect(rerun).toHaveBeenLastCalledWith('COT')
    expect(await screen.findByTestId('terminal-cot-board')).toBeTruthy()
    expect(timesAsked(rowsUrl('CL'))).toBe(1)           // back to the board is not a second fan-out
  })

  it('outside the terminal a row click still opens the market and writes nothing', async () => {
    serve(ALL)
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-cot-board')
    fireEvent.click(screen.getByTestId('terminal-cot-open-CL'))
    await screen.findByTestId('terminal-cot-classes')
    expect(screen.getByTestId('terminal-cot-asof').textContent).toBe('Crude Oil (CL). Report of Tue Nov 17, 2026.')
    expect(rerun).not.toHaveBeenCalled()
  })

  it('a word that matches no market says so over the board, and names what can be typed', async () => {
    serve(ALL)
    renderPanel({ market: 'ZZZ' }, { code: 'COT' })
    await screen.findByTestId('terminal-cot-board')
    expect(screen.getByTestId('terminal-cot-unknown').textContent).toBe('No market matches "ZZZ". Pick one below, or type a code or a plain word: COT GOLD, COT ES, COT 10Y.')
    expect(boardCodes()).toHaveLength(6)
    cleanup()
    clearCotBoardCache()
    serve(ALL)
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    expect(screen.queryByTestId('terminal-cot-unknown')).toBeNull()
  })

  it('says what net, the move and the range are, and calls no position bullish or bearish', async () => {
    serve(ALL)
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    const method = screen.getByTestId('terminal-cot-method').textContent
    expect(method).toContain('Net is long contracts minus short contracts; the stored report carries each class\'s net and total open interest, not the two sides.')
    expect(method).toContain('from 0 (the lowest net of the last 156 reports) to 100 (the highest)')
    expect(method).toContain('Futures only.')
    const all = screen.getByTestId('terminal-cot').textContent
    expect(all).not.toMatch(/bullish|bearish|crowded|extreme|smart money|signal/i)
    expect(all).not.toMatch(/—|–/)
  })
})

describe('COT one market', () => {
  it('a typed word opens that market and reads only its rows and its stored note: no board fan-out', async () => {
    serve(ALL)
    const { setFreshness } = renderPanel({ market: 'GOLD' })
    await screen.findByTestId('terminal-cot-classes')
    await screen.findByTestId('terminal-cot-note')
    expect(asked().sort()).toEqual([SYMBOLS_URL, rowsUrl('GC'), noteUrl('GC'), finerUrl('GC')].sort())   // + its own by-trader-type read
    expect(screen.getByTestId('terminal-cot').getAttribute('data-state')).toBe('market')
    expect(screen.getByTestId('terminal-cot').getAttribute('data-market')).toBe('GC')
    expect(screen.getByTestId('terminal-cot-asof').textContent).toBe('Gold (GC). Report of Tue Nov 17, 2026.')
    expect(screen.getByTestId('terminal-cot-weekly').textContent)
      .toBe('Weekly. The CFTC counts positions each Tuesday and publishes them the following Friday, so every figure is about three days old on the day it comes out.')
    expect(lastReport(setFreshness)).toEqual(WEEKLY_REPORT)
    for (const [, init] of jsonFetcher.mock.calls) expect(init?.method ?? 'GET').toBe('GET')
  })

  it('each class: its net over the week\'s change, its share of open interest and its place in the 3-year range', async () => {
    serve(ALL)
    renderPanel({ market: 'GC' })
    await screen.findByTestId('terminal-cot-classes')
    const classes = screen.getAllByTestId('terminal-cot-class')
    expect(classes.map((tr) => tr.getAttribute('data-class'))).toEqual(['largeSpecs', 'commercials', 'smallSpecs'])
    const cells = (tr) => [...tr.children].map((c) => c.textContent)
    expect(cells(classes[0])).toEqual(['Large speculators', '+180.0K+80.0K on the week', '+34.6%', '80 of 100'])
    expect(cells(classes[1])).toEqual(['Commercials', '-190.0K-70.0K on the week', '-36.5%', '30 of 100'])
    expect(cells(classes[2])).toEqual(['Small speculators', '+10.0K-10.0K on the week', '+1.9%', '50 of 100'])
    expect(classes[0].querySelector('th').getAttribute('title')).toBe('The CFTC\'s non-commercial traders: funds and other large traders')
    expect(screen.getByTestId('terminal-cot-oi').textContent).toBe('Open interest: 520.0K contracts, +20.0K on the week.')
    expect(screen.getByLabelText('Gold: net position of each trader class, report of Tue Nov 17, 2026')).toBeTruthy()
  })

  it('the history is the last eight reports, newest first, each with its own date', async () => {
    serve(ALL)
    renderPanel({ market: 'GC' })
    await screen.findByTestId('terminal-cot-history')
    const rows = screen.getAllByTestId('terminal-cot-history-row')
    expect(rows.map((r) => r.getAttribute('data-date'))).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(tue))
    const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)
    expect(cells(rows[0])).toEqual(['Tue Nov 17, 2026', '+180.0K', '-190.0K', '+10.0K', '520.0K'])
    expect(cells(rows[1])).toEqual(['Tue Nov 10, 2026', '+100.0K', '-120.0K', '+20.0K', '500.0K'])
    expect(cells(rows[2])).toEqual(['Tue Nov 3, 2026', '+200.0K', '-220.0K', '0', '500.0K'])
    expect(screen.getByLabelText('Gold: net positions in the last 8 weekly reports, newest first')).toBeTruthy()
  })

  it('with fewer than 156 reports the range reads n/a and says why; with one report there is no week change', async () => {
    serve(ALL)
    renderPanel({ market: 'CL' })
    await screen.findByTestId('terminal-cot-classes')
    expect(screen.getAllByTestId('terminal-cot-class-range').map((td) => td.textContent)).toEqual(['n/a', 'n/a', 'n/a'])
    expect(screen.getAllByTestId('terminal-cot-class-range')[0].getAttribute('title')).toBe('The 3-year range needs 156 weekly reports; 3 are stored.')
    expect(screen.getByTestId('terminal-cot-oi').textContent)
      .toBe('Open interest: 500.0K contracts, 0 on the week. The 3-year range needs 156 weekly reports; 3 are stored.')
    expect(screen.getAllByTestId('terminal-cot-history-row')).toHaveLength(3)
    cleanup()
    serve(ALL)
    renderPanel({ market: 'ZN' })
    await screen.findByTestId('terminal-cot-classes')
    expect(screen.getAllByTestId('terminal-cot-class-net').map((td) => td.textContent))
      .toEqual(['+180.0Kno earlier report', '-190.0Kno earlier report', '+10.0Kno earlier report'])
    expect(screen.getByTestId('terminal-cot-oi').textContent).toBe('Open interest: 520.0K contracts. The 3-year range needs 156 weekly reports; 1 is stored.')
  })

  it('every plain word and every code opens its own market', async () => {
    const codes = [...new Set(Object.values(COT_WORDS))]
    const roster = { groups: { ALL: codes.map((c) => ({ symbol: c, name: `Market ${c}` })) } }
    const routes = { [SYMBOLS_URL]: roster }
    for (const c of codes) { routes[rowsUrl(encodeURIComponent(c))] = GOLD.slice(-2); routes[noteUrl(encodeURIComponent(c))] = { symbol: c, rows: [] } }
    const words = [...Object.entries(COT_WORDS), ...codes.map((c) => [c, c]), ...codes.map((c) => [c.toLowerCase(), c])]
    expect(words.length).toBeGreaterThan(100)
    for (const [word, code] of words) {
      serve(routes)
      renderPanel({ market: word })
      await screen.findByTestId('terminal-cot-classes')
      expect(screen.getByTestId('terminal-cot').getAttribute('data-market'), word).toBe(code)
      expect(screen.getByTestId('terminal-cot-asof').textContent, word).toBe(`Market ${code} (${code}). Report of Tue Nov 17, 2026.`)
      cleanup()
    }
  })

  it('a market the list holds but with no stored report says so, keeps the picker, and is not an error', async () => {
    serve(ALL)
    const { setFreshness } = renderPanel({ market: 'NATGAS' })
    const box = await screen.findByTestId('terminal-cot-market-none')
    expect(box.textContent).toContain('No report is stored for Natural Gas (NG) yet.')
    expect(screen.getByTestId('terminal-cot-market').value).toBe('NG')
    expect(screen.queryByTestId('terminal-cot-error')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
  })

  it('a market whose read fails is an error naming it, with Retry; an answer that is not rows is a failed read', async () => {
    serve({ [SYMBOLS_URL]: SYMBOLS })
    renderPanel({ market: 'GC' }, { code: 'COT' })
    const err = await screen.findByTestId('terminal-cot-error')
    expect(err.textContent).toContain('Positioning for Gold could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no positions. Retry, or run COT again.')
    expect(screen.queryByTestId('terminal-cot-classes')).toBeNull()
    serve(ALL)
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-cot-classes')).toBeTruthy()
    cleanup()
    serve({ ...ALL, [rowsUrl('GC')]: { rows: [] } })
    renderPanel({ market: 'GC' })
    expect((await screen.findByTestId('terminal-cot-error')).textContent).toContain('Positioning for Gold could not be read just now.')
    expect(screen.queryByTestId('terminal-cot-market-none')).toBeNull()
  })

  it('a failed re-read keeps the last report on screen and says so', async () => {
    serve(ALL)
    renderPanel({ market: 'GC' })
    await screen.findByTestId('terminal-cot-classes')
    serve({ [SYMBOLS_URL]: SYMBOLS, [noteUrl('GC')]: NOTE })
    await act(async () => { await revalidateAll() })
    const note = await screen.findByTestId('terminal-cot-stale-read')
    expect(note.textContent).toBe('Futures positioning could not be read just now. Showing the last read.')
    expect(screen.getAllByTestId('terminal-cot-class')).toHaveLength(3)
  })
})

describe('COT the stored note', () => {
  it('is shown as stored, labelled with its own report date and as written by AI, and is never asked for', async () => {
    serve(ALL)
    renderPanel({ market: 'GC' })
    const note = await screen.findByTestId('terminal-cot-note')
    expect(screen.getByTestId('terminal-cot-note-label').textContent)
      .toBe('Stored note for the report of Tue Nov 17, 2026, written by AI from that report\'s figures.')
    expect([...note.querySelectorAll('p')].slice(1).map((p) => p.textContent))
      .toEqual(['Large speculators added to their net long.', 'Commercials added to their net short.'])
    expect(calls().filter((u) => /narrative/.test(u))).toEqual([noteUrl('GC')])
    expect(calls().some((u) => /\/narrative$|prewarm|recent/.test(u))).toBe(false)
    for (const [, init] of jsonFetcher.mock.calls) expect(init?.method ?? 'GET').toBe('GET')
  })

  it('a note for an earlier report says it is older than the figures', async () => {
    serve({ ...ALL, [noteUrl('GC')]: { symbol: 'GC', rows: [{ report_date: '2026-11-10', text: 'An earlier week.' }] } })
    renderPanel({ market: 'GC' })
    await screen.findByTestId('terminal-cot-note')
    expect(screen.getByTestId('terminal-cot-note-label').textContent)
      .toBe('Stored note for the report of Tue Nov 10, 2026, written by AI from that report\'s figures. It is older than the figures above.')
  })

  it('no stored note says so; a note that cannot be read says so and leaves the figures on screen', async () => {
    serve({ ...ALL, [noteUrl('CL')]: { symbol: 'CL', rows: [] } })
    renderPanel({ market: 'CL' })
    expect((await screen.findByTestId('terminal-cot-note-none')).textContent).toBe('No written note is stored for this market.')
    expect(screen.queryByTestId('terminal-cot-note')).toBeNull()
    cleanup()
    serve(ALL)                                           // no narratives route for SI: it answers 500
    renderPanel({ market: 'SI' })
    expect((await screen.findByTestId('terminal-cot-note-failed')).textContent).toBe('The stored note for this market could not be read just now.')
    expect(screen.getAllByTestId('terminal-cot-class')).toHaveLength(3)
    expect(screen.queryByTestId('terminal-cot-error')).toBeNull()
  })
})

describe('COT the picker', () => {
  it('lists the board and every market once, and shows which is open', async () => {
    serve(ALL)
    renderPanel({ market: 'SILVER' })
    await screen.findByTestId('terminal-cot-classes')
    const select = screen.getByTestId('terminal-cot-market')
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'All markets (the board)', 'S&P 500 E-mini (ES)', 'Nasdaq 100 E-mini (NQ)', 'Gold (GC)', 'Silver (SI)', '10-Year T-Note (ZN)', 'Crude Oil (CL)',
      'Natural Gas (NG)',
    ])
    expect(select.value).toBe('SI')
  })

  it('inside the terminal the picker writes the market, or the bare code for the board, into the command', async () => {
    serve(ALL)
    const { rerun } = renderPanel({ market: 'GOLD' }, { code: 'COT' })
    await screen.findByTestId('terminal-cot-classes')
    pickMarket('SI')
    expect(rerun).toHaveBeenLastCalledWith('COT SI')
    await waitFor(() => expect(screen.getByTestId('terminal-cot').getAttribute('data-market')).toBe('SI'))
    pickMarket('')
    expect(rerun).toHaveBeenLastCalledWith('COT')
    expect(await screen.findByTestId('terminal-cot-board')).toBeTruthy()
    expect(rerun).toHaveBeenCalledTimes(2)
  })

  it('outside the terminal the picker still works and writes nothing', async () => {
    serve(ALL)
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-cot-board')
    pickMarket('CL')
    await screen.findByTestId('terminal-cot-classes')
    expect(screen.getByTestId('terminal-cot-asof').textContent).toContain('Crude Oil (CL).')
    expect(rerun).not.toHaveBeenCalled()
  })

  it('a new command word is a new view: one market\'s figures are never drawn under another\'s name', async () => {
    serve({ ...ALL, [rowsUrl('SI')]: PENDING })
    const { rerender } = renderPanel({ market: 'GOLD' })
    await screen.findByTestId('terminal-cot-classes')
    rerender({ market: 'SILVER' })
    await waitFor(() => expect(screen.getByTestId('terminal-cot-loading')).toBeTruthy())
    expect(screen.queryByTestId('terminal-cot-classes')).toBeNull()
    expect(asked()).toContain(rowsUrl('SI'))
  })
})

describe('COT by trader type: one market', () => {
  const finerRows = () => screen.getAllByTestId('terminal-cot-finer-class')
  const cellsOf = (tr) => [...tr.children].map((c) => c.textContent)

  it('sits below the classes table and above the history, with its own report, every class, the credit and the record', async () => {
    serve(ALL)
    renderPanel({ market: 'GOLD' })
    const table = await screen.findByTestId('terminal-cot-finer-classes')
    const classes = screen.getByTestId('terminal-cot-classes')
    const history = screen.getByTestId('terminal-cot-history')
    expect(classes.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(table.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const section = screen.getByTestId('terminal-cot-finer')
    expect(section.getAttribute('data-state')).toBe('ok')
    expect(within(section).getByRole('heading', { level: 3 }).textContent).toBe('By trader type')
    expect(screen.getByTestId('terminal-cot-finer-asof').textContent).toBe("The CFTC's Disaggregated report of Tue Nov 17, 2026.")
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent))
      .toEqual(['Trader class', 'Net, contracts', 'Long and short', 'Share of open interest', '3-year range'])
    expect(finerRows().map((tr) => tr.getAttribute('data-class'))).toEqual(DIS_KEYS)
    expect(cellsOf(finerRows()[0])).toEqual(['Producers and merchants', '-160.0K0 on the week', '50.0K long210.0K short', '-30.8%', '50 of 100'])
    expect(cellsOf(finerRows()[1])).toEqual(['Swap dealers', '-70.0K0 on the week', '20.0K long90.0K short1,234 spreading', '-13.5%', '50 of 100'])
    expect(cellsOf(finerRows()[2])).toEqual(['Managed moneywatched most', '+240.0K+80.0K on the week', '280.0K long40.0K short30.0K spreading', '+46.2%', '80 of 100'])
    expect(cellsOf(finerRows()[4])).toEqual(['Small traders', '-5,0000 on the week', '45.0K long50.0K short', '-1.0%', '50 of 100'])
    expect(finerRows()[2].querySelector('th').getAttribute('title')).toBe("The CFTC's Managed Money: commodity trading advisers and hedge funds, the speculators of the commodity markets. Traders: 88 long, 21 short, 34 spreading.")
    expect(finerRows()[4].querySelector('th').getAttribute('title')).toBe("The CFTC's Nonreportable Positions: positions too small to report.")
    expect(screen.getByTestId('terminal-cot-finer-credit').textContent)
      .toBe('Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), as of the Tuesday it covers, published the following Friday.')
    expect(screen.getByTestId('terminal-cot-finer-record').textContent).toBe('CFTC record: INVENTED METAL - INVENTED EXCHANGE, contract INV001.')
    expect(screen.getByTestId('terminal-cot-finer-concentration').textContent).toBe('The largest 4 traders hold 21.7% of the long side and 18.0% of the short side; the largest 8 hold 33.1% of the long side and 29.4% of the short side (gross positions).')
    expect(screen.getByLabelText("Gold: positions of each trader class in the CFTC's Disaggregated report of Tue Nov 17, 2026")).toBe(table)
    expect(within(table).getAllByTestId('terminal-cot-finer-net')[2].querySelector('span').className).toMatch(/up/)
    expect(within(table).getAllByTestId('terminal-cot-finer-net')[0].querySelector('span').className).toMatch(/down/)
    expect(screen.getByTestId('terminal-cot').textContent).not.toMatch(/bullish|bearish|crowded|extreme|smart money|signal|—|–/i)
  })

  it('a report older or newer than the legacy figures says so; a range under 156 weeks reads n/a and says why', async () => {
    serve({ ...ALL, [finerUrl('GC')]: finerGold(20, 1) })
    renderPanel({ market: 'GC' })
    expect((await screen.findByTestId('terminal-cot-finer-asof')).textContent)
      .toBe("The CFTC's Disaggregated report of Tue Nov 10, 2026. It is older than the figures above.")
    const ranges = screen.getAllByTestId('terminal-cot-finer-range')
    expect(ranges.map((td) => td.textContent)).toEqual(['n/a', 'n/a', 'n/a', 'n/a', 'n/a'])
    expect(ranges[2].getAttribute('title')).toBe('The 3-year range needs 156 weekly reports of this class; 20 are stored.')
    cleanup()
    serve({ ...ALL, [finerUrl('GC')]: finerGold(160, -1) })
    renderPanel({ market: 'GC' })
    expect((await screen.findByTestId('terminal-cot-finer-asof')).textContent).toContain('It is newer than the figures above.')
  })

  it('not read yet, no record, a failed read with Retry, a paid-plan lock and an unreadable store each say so, and the legacy figures stay', async () => {
    const cases = [
      [{ state: 'not_built', source: 'x', next_check: 'x' }, 'not_built', "The CFTC's Traders in Financial Futures and Disaggregated reports have not been read on this server yet. They are read after each Friday's report, in the evening, New York time."],
      [{ state: 'no_record', source: 'x' }, 'no_record', "Neither of the CFTC's finer reports (Traders in Financial Futures, Disaggregated) carries a record of Gold."],
      [{ state: 'unavailable', reason: 'x' }, 'failed', 'Positioning by trader type could not be read just now. Retry'],
      [{ rows: [] }, 'failed', 'Positioning by trader type could not be read just now. Retry'],
      [fail(500), 'failed', 'Positioning by trader type could not be read just now. Retry'],
      [fail(402), 'failed', 'Positioning by trader type needs a paid plan. '],
    ]
    for (const [answer, state, words] of cases) {
      serve({ ...ALL, [finerUrl('GC')]: answer })
      renderPanel({ market: 'GC' })
      await waitFor(() => expect(screen.getByTestId('terminal-cot-finer').getAttribute('data-state')).toBe(state))
      const said = screen.queryByTestId('terminal-cot-finer-none') || screen.getByTestId('terminal-cot-finer-failed')
      expect(said.textContent.replace(/\s+/g, ' ')).toBe(words)
      expect(screen.getAllByTestId('terminal-cot-class')).toHaveLength(3)           // the legacy table stays
      expect(screen.queryByTestId('terminal-cot-finer-classes')).toBeNull()
      cleanup()
    }
  })

  it('Retry asks for the market again, and a failed re-read keeps the last table on screen and says so', async () => {
    serve({ ...ALL, [finerUrl('GC')]: fail(500) })
    renderPanel({ market: 'GC' })
    fireEvent.click(await screen.findByTestId('terminal-cot-finer-retry'))
    await waitFor(() => expect(timesAsked(finerUrl('GC'))).toBe(2))
    cleanup()
    serve(ALL)
    renderPanel({ market: 'GC' })
    await screen.findByTestId('terminal-cot-finer-classes')
    serve({ ...ALL, [finerUrl('GC')]: fail(503) })
    await act(async () => { await revalidateAll() })
    expect((await screen.findByTestId('terminal-cot-finer-stale')).textContent).toBe('Positioning by trader type could not be read just now. Showing the last read.')
    expect(screen.getByTestId('terminal-cot-finer-classes')).toBeTruthy()
  })

  it('shows a loading line while its read is out, and the rest of the market is already drawn', async () => {
    serve({ ...ALL, [finerUrl('GC')]: PENDING })
    renderPanel({ market: 'GC' })
    expect((await screen.findByTestId('terminal-cot-finer-loading')).textContent).toBe('Loading positioning by trader type.')
    expect(screen.getByTestId('terminal-cot-classes')).toBeTruthy()
  })
})

describe('COT by trader type: the board', () => {
  it('the funds column never holds the board back: while its read is out the board draws and each cell says loading', async () => {
    serve({ ...ALL, [FINER_BOARD_URL]: PENDING })
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    expect(screen.getAllByTestId('terminal-cot-board-funds').map((td) => td.textContent)).toEqual(Array(6).fill('loading'))
    expect(screen.queryByTestId('terminal-cot-funds-failed')).toBeNull()
  })

  it('a market with no record is n/a with why; the method names both classes; the credit is there', async () => {
    serve(ALL)
    renderPanel()
    await screen.findByTestId('terminal-cot-board')
    const funds = screen.getAllByTestId('terminal-cot-board-funds')
    expect(funds[2].getAttribute('title')).toBe("Neither of the CFTC's finer reports carries a record of this market.")
    expect(funds[0].querySelector('span').className).toMatch(/up/)
    expect(funds[3].querySelector('span').className).toMatch(/down/)
    expect(screen.getByTestId('terminal-cot-funds-method').textContent.replace(/\s+/g, ' ')).toContain(
      'leveraged funds in the Traders in Financial Futures report (stock indexes, rates, currencies, crypto), managed money in the Disaggregated report (commodities)')
    expect(screen.getByTestId('terminal-cot-funds-credit').textContent).toBe(
      'Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), as of the Tuesday it covers, published the following Friday.')
    expect(screen.queryByTestId('terminal-cot-funds-failed')).toBeNull()
    expect(screen.queryByTestId('terminal-cot-funds-none')).toBeNull()
  })

  it('not read yet, a failed read with Retry and a paid-plan lock each say so once under the board; every cell is n/a', async () => {
    serve({ ...ALL, [FINER_BOARD_URL]: { state: 'not_built', source: 'x' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-cot-funds-none')).textContent.replace(/\s+/g, ' '))
      .toBe("The funds column is blank: the CFTC's finer reports have not been read on this server yet. They are read after each Friday's report, in the evening, New York time.")
    expect(screen.getAllByTestId('terminal-cot-board-funds').map((td) => td.textContent)).toEqual(Array(6).fill('n/a'))
    cleanup()
    serve({ ...ALL, [FINER_BOARD_URL]: fail(500) })
    renderPanel()
    const failed = await screen.findByTestId('terminal-cot-funds-failed')
    expect(failed.textContent).toBe('Positioning by trader type could not be read just now. The funds column is blank. Retry')
    expect(boardCodes()).toEqual(['GC', 'CL', 'NQ', 'ES', 'SI', 'ZN'])               // the board itself is whole
    serve(ALL)
    fireEvent.click(screen.getByTestId('terminal-cot-funds-retry'))
    await waitFor(() => expect(screen.queryByTestId('terminal-cot-funds-failed')).toBeNull())
    expect(screen.getAllByTestId('terminal-cot-board-funds')[0].textContent).toBe('+120.0K+20.0K on the weekManaged money')
    cleanup()
    serve({ ...ALL, [FINER_BOARD_URL]: fail(402) })
    renderPanel()
    expect((await screen.findByTestId('terminal-cot-funds-failed')).textContent).toBe('Positioning by trader type needs a paid plan. The funds column is blank. ')
    expect(screen.queryByTestId('terminal-cot-funds-retry')).toBeNull()
  })

  it('the board and one market each pass axe with the by-trader-type parts in every state (WCAG A and AA)', async () => {
    serve({ ...ALL, [FINER_BOARD_URL]: fail(500) })
    renderPanel({}, { code: 'COT' })
    await screen.findByTestId('terminal-cot-funds-failed')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ ...ALL, [finerUrl('GC')]: { state: 'not_built' } })
    renderPanel({ market: 'GC' }, { code: 'COT' })
    await screen.findByTestId('terminal-cot-finer-none')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ ...ALL, [finerUrl('GC')]: fail(500) })
    renderPanel({ market: 'GC' }, { code: 'COT' })
    await screen.findByTestId('terminal-cot-finer-failed')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})

describe('COT follows the member\'s theme', () => {
  it('the panel, its model and its board read hold no hard-coded color', () => {
    for (const f of ['CotPanel.jsx', 'cotModel.js', 'useCotBoard.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('COT accessibility', () => {
  it('the board, one market with its note, an unknown word, a failed market and a failed read pass axe (WCAG A and AA)', async () => {
    serve(ALL)
    renderPanel({}, { code: 'COT' })
    await screen.findByTestId('terminal-cot-board')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve(ALL)
    renderPanel({ market: 'GOLD' }, { code: 'COT' })
    await screen.findByTestId('terminal-cot-note')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    clearCotBoardCache()
    serve({ ...ALL, [rowsUrl('CL')]: fail(500) })
    renderPanel({ market: 'ZZZ' })
    await screen.findByTestId('terminal-cot-failed')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({})
    renderPanel()
    await screen.findByTestId('terminal-cot-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
