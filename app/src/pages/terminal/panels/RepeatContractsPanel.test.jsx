// ACCUM: repeat-hit option contracts under the day's flow read. Rails:
//   * today asks for exactly the two keys the flow-worker keeps warm, and nothing else;
//   * the two reads fail apart: a failed list is an error with Retry under a read that still
//     shows; a failed read is a note above a list that still shows;
//   * signed out, a paywall and a switched-off route are said once, by the list;
//   * an answer that is not the route's shape is an error, never an empty list or a day of zeros;
//   * a healthy answer with no contracts says nothing has been hit often enough, for which date,
//     and offers the weekday before; that pick reads the past day and can be undone;
//   * the read line: which side leads, the dollars, the share worked out from them, the last hour,
//     a cut day; a day with no premium is not a 0% or a 50%;
//   * the list: hits, premium, direction with its share, grade without its picture; the two
//     orders; row numbers follow the rows on screen; a symbol loads into the linked panels.
// The fixtures are the routes' real shapes (api/live_massive_router.py _build_day_stats and
// _build_by_contract), with made-up tickers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
// The list alert switch has its own test (ListAlertSwitch.test.jsx). Here it is a marker, so this
// file's reads stay the panel's own, and one test at the end pins that the panel mounts it.
vi.mock('./ListAlertSwitch', async () => {
  const { createElement } = await import('react')
  return { default: ({ kind }) => createElement('span', { 'data-testid': 'list-alert-stub', 'data-kind': kind, hidden: true }) }
})
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import RepeatContractsPanel, { MAX_ROWS, contractText, dayReadUrl, repeatContractsUrl } from './RepeatContractsPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT options flow'
const READ_URL = '/api/live/massive/day-stats?stock_etf=all'
const LIST_URL = '/api/live/massive/by-contract?stock_etf=all&min_hits=3&lookback_days=1'
const ROCKET = String.fromCodePoint(0x1F680)
/** The hyphen a date is drawn with, so it never breaks a line. */
const HY = String.fromCharCode(0x2011)
const NBSP = String.fromCharCode(160)
const DAY = {
  query_date: '11/16/2026', total_classified: 5120, directional_count: 4210, covers_from: null,
  bull_premium: 812000000.0, bear_premium: 640000000.0, bull_count: 2500, bear_count: 1710,
  by_dte: [{ label: '0-7d', bull: 1, bear: 2, count: 3 }],
  top_bull: [{ ticker: 'AAA', premium: 40000000.0 }],
  top_bear: [{ ticker: 'CCC', premium: 31000000.0 }],
  last_hour: { bull_premium: 90000000.0, bear_premium: 60000000.0, count: 300, is_today_target: true, top_tickers: [] },
}
const NO_TAPE = {
  query_date: '11/16/2026', total_classified: 0, directional_count: 0, covers_from: null, bull_premium: 0, bear_premium: 0, bull_count: 0,
  bear_count: 0, by_dte: [], top_bull: [], top_bear: [], last_hour: { bull_premium: 0, bear_premium: 0, count: 0, is_today_target: true, top_tickers: [] },
}
const CONTRACTS = {
  query_date: '11/16/2026', stock_etf: 'all', min_hits: 3, contract_count: 3, budget_cut_days: [],
  contracts: [
    {
      ticker: 'AAA', cp: 'C', strike: 420.0, exp: '12/18/2026', source: 'stocks', dte: 32, avg_fill: 4.2, spot: 401.5, hit_count: 14,
      qualifying_hits: 9, floor: 250000, total_premium: 2240000, total_volume: 5300, bull_premium: 1926400, bear_premium: 0, direction: 'Bull',
      consistency: 1.0, sided_pct: 0.86, cum_voi: 4.4, max_oi: 1200, grade: 'A', accumulation_grade: 'A', accumulation_score: 7.1,
      accumulation_shape: 'intraday_burst', swift_hits: 6, steady_hits: 8, burst_rising: true, is_intraday_burst: true, dormant: false,
      score: 50000000, first_ts: 1794839400, last_ts: 1794855600, prints: [],
    },
    {
      ticker: 'BBB', cp: 'P', strike: 27.5, exp: '1/15/2027', source: 'stocks', dte: 60, hit_count: 4, qualifying_hits: 4, floor: 15000,
      total_premium: 400000, total_volume: 900, bull_premium: 100000, bear_premium: 220000, direction: 'Mixed', consistency: 0.69,
      sided_pct: 0.8, cum_voi: null, max_oi: 0, accumulation_grade: `A+ ${ROCKET}`, accumulation_shape: 'single', swift_hits: 1,
      burst_rising: false, is_intraday_burst: false, dormant: true, score: 90000000, first_ts: 1794840000, last_ts: 1794852000, prints: [],
    },
    {
      ticker: 'CCC', cp: 'P', strike: 150, exp: '3/19/2027', source: 'stocks', dte: 123, hit_count: 3, qualifying_hits: 3, floor: 25000,
      total_premium: 900000, total_volume: 2100, bull_premium: 0, bear_premium: 0, direction: 'Unclear', consistency: 0.0, sided_pct: 0.0,
      cum_voi: 0.6, max_oi: 5000, accumulation_grade: 'C', accumulation_shape: 'single', swift_hits: 2, burst_rising: false,
      is_intraday_burst: false, dormant: false, score: 100000, first_ts: 1794841000, last_ts: 1794848400, prints: [],
    },
  ],
}
const NO_CONTRACTS = { ...CONTRACTS, contracts: [], contract_count: 0 }
const PAST = '2026-11-13'
const PAST_READ_URL = `${READ_URL}&target_date=${PAST}`
const PAST_LIST_URL = `${LIST_URL}&target_date=${PAST}`

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
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([url]) => url))].sort()

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <RepeatContractsPanel {...props} />
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
const rows = () => screen.getAllByTestId('terminal-accum-row')
const syms = () => rows().map((r) => r.getAttribute('data-sym'))
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('ACCUM what is read', () => {
  it('today asks for exactly the two keys the flow-worker keeps warm', () => {
    serve({ [READ_URL]: PENDING, [LIST_URL]: PENDING })
    renderPanel()
    expect(screen.getByTestId('terminal-accum-loading')).toBeTruthy()
    expect(screen.getByTestId('terminal-accum-read-loading').textContent).toBe("Reading the day's flow.")
    expect(screen.queryByRole('table')).toBeNull()
    expect(asked()).toEqual([LIST_URL, READ_URL])
    expect([dayReadUrl(), repeatContractsUrl()]).toEqual([READ_URL, LIST_URL])
  })

  it('a typed past day reads that day for both, and can be undone', async () => {
    serve({ [PAST_READ_URL]: { ...DAY, query_date: '11/13/2026', last_hour: { ...DAY.last_hour, is_today_target: false } },
      [PAST_LIST_URL]: { ...CONTRACTS, query_date: '11/13/2026' }, [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    renderPanel({ date: PAST })
    await screen.findByTestId('terminal-accum-table')
    expect(asked()).toEqual([PAST_LIST_URL, PAST_READ_URL])
    expect(screen.getByTestId('terminal-accum').getAttribute('data-date')).toBe(PAST)
    expect(screen.getByTestId('terminal-accum-day').textContent).toBe(`Showing 2026${HY}11${HY}13, a past session.`)
    expect(screen.getByTestId('terminal-accum-read').textContent).toContain('Bullish premium leads for 2026-11-13:')
    // a past day's last hour is the last hour of that session, not "the last 60 minutes"
    expect(screen.getByTestId('terminal-accum-read').textContent).toContain('Last hour of the session: $90.0M bullish, $60.0M bearish.')
    expect(screen.getByRole('table', { name: 'Repeat-hit option contracts for 2026-11-13, 3 contracts' })).toBeTruthy()
    fireEvent.click(screen.getByTestId('terminal-accum-today'))
    await waitFor(() => expect(screen.getByTestId('terminal-accum-read').textContent).toContain('for 2026-11-16:'))
    expect(screen.getByTestId('terminal-accum').getAttribute('data-date')).toBe('')
    expect(screen.queryByTestId('terminal-accum-day')).toBeNull()
    expect(asked()).toEqual([LIST_URL, PAST_LIST_URL, READ_URL, PAST_READ_URL].sort())
  })

  it('a day that is not a real day is today', () => {
    serve({ [READ_URL]: PENDING, [LIST_URL]: PENDING })
    renderPanel({ date: '2026-02-30' })
    expect(asked()).toEqual([LIST_URL, READ_URL])
    expect(screen.queryByTestId('terminal-accum-day')).toBeNull()
  })
})

describe('ACCUM states', () => {
  it('a failed list (500) is an error with Retry under a read that still shows', async () => {
    serve({ [READ_URL]: DAY })
    renderPanel({}, { code: 'ACCX' })
    const err = await screen.findByTestId('terminal-accum-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The repeat-hit contracts list could not be read just now.')
    expect(err.textContent).toContain('That is not the same as an empty list. Retry, or run ACCX again.')
    expect(screen.queryByTestId('terminal-accum-empty')).toBeNull()
    expect((await screen.findByTestId('terminal-accum-read')).textContent).toContain('Bullish premium leads')
    serve({ [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-accum-table')).toBeTruthy()
  })

  it('a failed read (500) is a note above a list that still shows, and can be retried on its own', async () => {
    serve({ [LIST_URL]: CONTRACTS })
    renderPanel()
    await screen.findByTestId('terminal-accum-table')
    const note = await screen.findByTestId('terminal-accum-read-error')
    expect(note.textContent).toContain("The day's flow read could not be read just now. The contracts below are a separate read.")
    expect(screen.queryByTestId('terminal-accum-read')).toBeNull()
    expect(syms()).toHaveLength(3)
    serve({ [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    fireEvent.click(screen.getByRole('button', { name: 'Retry the read' }))
    expect((await screen.findByTestId('terminal-accum-read')).textContent).toContain('Bullish premium leads')
  })

  it('signed out (401) and locked (402, 404) are said once, by the list', async () => {
    for (const [status, kind, words] of [
      [401, 'error', 'You are signed out, so the repeat-hit contracts list cannot be read. Sign in again.'],
      [402, 'locked', 'The repeat-hit contracts list needs a paid plan.'],
      [404, 'locked', 'The repeat-hit contracts list is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve({ [READ_URL]: fail(status), [LIST_URL]: fail(status) })
      renderPanel()
      const state = await screen.findByTestId('terminal-accum-error')
      expect(state.getAttribute('data-kind'), String(status)).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), String(status)).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-accum-empty')).toBeNull()
      // the read line does not repeat it, and never shows a day of zeros
      await waitFor(() => expect(screen.queryByTestId('terminal-accum-read-loading')).toBeNull())
      expect(screen.queryByTestId('terminal-accum-read-error')).toBeNull()
      expect(screen.queryByTestId('terminal-accum-read')).toBeNull()
    }
  })

  it('an answer that is not the route\'s shape is an error for the list and a note for the read', async () => {
    serve({ [READ_URL]: { detail: 'upstream said something else' }, [LIST_URL]: { detail: 'upstream said something else' } })
    renderPanel()
    const err = await screen.findByTestId('terminal-accum-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The repeat-hit contracts list could not be read just now.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-accum-empty')).toBeNull()
    expect((await screen.findByTestId('terminal-accum-read-error')).textContent).toContain("The day's flow read could not be read just now.")
    expect(screen.queryByTestId('terminal-accum-read')).toBeNull()
  })

  it('no contracts today says so, for which date, and offers the weekday before', async () => {
    serve({ [READ_URL]: NO_TAPE, [LIST_URL]: NO_CONTRACTS,
      [PAST_READ_URL]: { ...DAY, query_date: '11/13/2026' }, [PAST_LIST_URL]: { ...CONTRACTS, query_date: '11/13/2026' } })
    const { setFreshness, rerun } = renderPanel()
    const empty = await screen.findByTestId('terminal-accum-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No contract has been hit 3 or more times on 2026-11-16 yet.')
    expect(empty.textContent).toContain('Before the open, on a weekend and on a market holiday it stays empty until the next session trades.')
    expect(screen.getByTestId('terminal-accum-read').textContent).toBe('No directional option premium has been read for 2026-11-16 yet.')
    // a day with no premium is never drawn as 0% or 50%
    expect(document.body.textContent).not.toMatch(/\d%/)
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    // 2026-11-16 is a Monday: the weekday before is Friday the 13th
    expect(screen.getByTestId('terminal-accum-earlier').textContent).toBe(`Show the weekday before (2026${HY}11${HY}13)`)
    fireEvent.click(screen.getByTestId('terminal-accum-earlier'))
    await screen.findByTestId('terminal-accum-table')
    expect(screen.getByTestId('terminal-accum').getAttribute('data-date')).toBe(PAST)
    expect(asked()).toEqual([LIST_URL, PAST_LIST_URL, READ_URL, PAST_READ_URL].sort())
    // outside a registered panel nothing is written back: the pick is plain component state
    expect(rerun).not.toHaveBeenCalled()
  })

  it('no contracts on a past day says that day had none, and still offers the weekday before', async () => {
    serve({ [PAST_READ_URL]: { ...NO_TAPE, query_date: '11/13/2026' }, [PAST_LIST_URL]: { ...NO_CONTRACTS, query_date: '11/13/2026' } })
    renderPanel({ date: PAST })
    const empty = await screen.findByTestId('terminal-accum-empty')
    expect(empty.textContent).toContain('No contract was hit 3 or more times on 2026-11-13.')
    expect(empty.textContent).toContain('A weekend or a market holiday has no trades.')
    expect((await screen.findByTestId('terminal-accum-read')).textContent).toBe('No directional option premium was read for 2026-11-13.')
    expect(screen.getByTestId('terminal-accum-earlier').textContent).toBe(`Show the weekday before (2026${HY}11${HY}12)`)
  })
})

describe('ACCUM populated', () => {
  it('the read line says which side leads, with the dollars, the share and the last hour', async () => {
    serve({ [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    renderPanel()
    const line = await screen.findByTestId('terminal-accum-read')
    expect(line.getAttribute('data-lean')).toBe('bullish')
    // 812 of 1,452 is 56%: worked out from the dollars, the route sends no percent
    expect(line.textContent).toBe('Bullish premium leads for 2026-11-16: $812.0M bullish (56%) against $640.0M bearish, from 4,210 directional trades. Last 60 minutes: $90.0M bullish, $60.0M bearish.')
    expect(screen.queryByTestId('terminal-accum-read-cut')).toBeNull()
  })

  it('a bearish day says so, and a cut day says the morning is missing', async () => {
    serve({ [READ_URL]: { ...DAY, bull_premium: 200000000, bear_premium: 600000000, covers_from: 1794847560 }, [LIST_URL]: CONTRACTS })
    renderPanel()
    const line = await screen.findByTestId('terminal-accum-read')
    expect(line.getAttribute('data-lean')).toBe('bearish')
    expect(line.textContent).toContain('Bearish premium leads for 2026-11-16: $200.0M bullish (25%) against $600.0M bearish')
    expect(screen.getByTestId('terminal-accum-read-cut').textContent)
      .toMatch(/^The server cut this day's read: it starts at \d{1,2}:\d{2} [AP]M ET, so the morning is missing from these totals\.$/)
  })

  it('lists every contract with its hits, premium, direction and grade, strongest first', async () => {
    serve({ [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    const { setFreshness, publishRows } = renderPanel()
    await screen.findByTestId('terminal-accum-table')
    // the server sends AAA, BBB, CCC (latest first); its score ranks BBB, AAA, CCC
    expect(syms()).toEqual(['BBB', 'AAA', 'CCC'])
    const cells = rows().map((r) => r.textContent)
    for (const s of ['1', 'BBB', `$27.50 put, expires 2027${HY}01${HY}15`, '4', '$400K', 'Mixed, mostly bearish', '(55%)', 'A+']) expect(cells[0]).toContain(s)
    // no open interest was known for BBB: no ratio is drawn, and never a 0.0×
    expect(cells[0]).not.toContain('OI')
    expect(cells[0]).not.toContain(ROCKET)
    expect(cells[0]).not.toContain(' of')
    for (const s of ['2', 'AAA', `$420 call, expires 2026${HY}12${HY}18`, `9 of${NBSP}14`, '$2.2M', `4.4×${NBSP}OI`, 'Bullish', '(86%)', `A 6 in 5${NBSP}min, price rising`]) expect(cells[1]).toContain(s)
    for (const s of ['3', 'CCC', `$150 put, expires 2027${HY}03${HY}19`, '$900K', `0.6×${NBSP}OI`, 'Side not clear', 'C']) expect(cells[2]).toContain(s)
    // a contract with no readable side has no share: never a 0%
    expect(cells[2]).not.toContain('%')
    expect(rows().map((r) => r.getAttribute('data-direction'))).toEqual(['mixed', 'bullish', 'unclear'])
    expect(screen.getByRole('table', { name: 'Repeat-hit option contracts for 2026-11-16, 3 contracts' })).toBeTruthy()
    // the header: the source and the newest trade in the list, as the instant the server sent
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, observedAt: new Date(1794855600 * 1000).toISOString() })))
    expect(publishRows).toHaveBeenLastCalledWith(['$BBB', '$AAA', '$CCC'])
    const method = screen.getByTestId('terminal-accum-method').textContent
    expect(method).toContain('A contract is listed when it was hit 3 or more times in the session')
    expect(method).toContain('it is not a forecast or a recommendation.')
    expect(method).toMatch(/Newest trade in this list: \d{1,2}:\d{2} [AP]M ET\./)
    expect(method).toMatch(/Read at \d{1,2}:\d{2} [AP]M ET\./)
    expect(document.body.textContent).not.toMatch(/[—–]/)
    expect(asked()).toEqual([LIST_URL, READ_URL])
  })

  it('contractText says a contract in plain words, and leaves out what the row lacks', () => {
    expect(contractText({ side: 'call', strike: 420, expiry: '2026-12-18' })).toBe('$420 call, expires 2026-12-18')
    expect(contractText({ side: 'put', strike: 27.5, expiry: null })).toBe('$27.50 put')
    expect(contractText({ side: null, strike: null, expiry: null })).toBe('Not given')
    expect(contractText(null)).toBe('Not given')
  })

  it('a symbol loads into the linked panels', async () => {
    serve({ [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    const { run } = renderPanel()
    await screen.findByTestId('terminal-accum-table')
    fireEvent.click(screen.getByTestId('panel-symbol-CCC'))
    expect(run).toHaveBeenCalledWith('$CCC')
  })

  it('draws a long list a hundred at a time', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...CONTRACTS.contracts[0], ticker: `T${String(i).padStart(3, '0')}`, score: 1000 + i, last_ts: 1794855600 - i,
    }))
    serve({ [READ_URL]: DAY, [LIST_URL]: { ...CONTRACTS, contracts: many, contract_count: 120 } })
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-accum-table')
    expect(rows()).toHaveLength(MAX_ROWS)
    // strongest first: the highest score is T119
    expect(syms()[0]).toBe('T119')
    expect(screen.getByTestId('terminal-accum-method').textContent).toContain('Showing the first 100 of 120 in this order. ')
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(100)
    fireEvent.click(screen.getByTestId('terminal-accum-all'))
    expect(rows()).toHaveLength(120)
    expect(screen.getByTestId('terminal-accum-all').textContent).toBe('Show the first 100')
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(120)
  })
})

describe('ACCUM chips', () => {
  it('the order chips reorder the same read, and the row numbers follow', async () => {
    serve({ [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    const { rerun, publishRows } = renderPanel()
    await screen.findByTestId('terminal-accum-table')
    expect(screen.getByTestId('terminal-accum-order-strong').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-accum-order-latest'))
    expect(screen.getByTestId('terminal-accum').getAttribute('data-order')).toBe('latest')
    expect(screen.getByTestId('terminal-accum-order-latest').getAttribute('aria-pressed')).toBe('true')
    expect(syms()).toEqual(['AAA', 'BBB', 'CCC'])
    expect(within(rows()[0]).getByText('1')).toBeTruthy()
    await waitFor(() => expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC']))
    // outside a registered panel nothing is written back, and no second read is made
    expect(rerun).not.toHaveBeenCalled()
    expect(asked()).toEqual([LIST_URL, READ_URL])
  })

  it('the order prop seeds the chip', async () => {
    serve({ [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    renderPanel({ order: 'LATEST' })
    await screen.findByTestId('terminal-accum-table')
    expect(screen.getByTestId('terminal-accum').getAttribute('data-order')).toBe('latest')
    expect(syms()).toEqual(['AAA', 'BBB', 'CCC'])
  })

  it('inside a panel whose code does not take the word, the chip still reorders and writes nothing', async () => {
    // MOST is a registered code whose market variant takes UP and DOWN, not LATEST.
    serve({ [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    const { rerun } = renderPanel({}, { code: 'MOST' })
    await screen.findByTestId('terminal-accum-table')
    fireEvent.click(screen.getByTestId('terminal-accum-order-latest'))
    expect(syms()).toEqual(['AAA', 'BBB', 'CCC'])
    expect(rerun).not.toHaveBeenCalled()
    // back to today, strongest first is the bare command, which every code takes
    fireEvent.click(screen.getByTestId('terminal-accum-order-strong'))
    expect(rerun).toHaveBeenLastCalledWith('MOST')
  })
})

describe('ACCUM follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['RepeatContractsPanel.jsx', 'repeatContractsModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('ACCUM accessibility', () => {
  it('the list, a past day and the empty state pass axe (WCAG A and AA)', async () => {
    serve({ [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    renderPanel()
    await screen.findByTestId('terminal-accum-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [PAST_READ_URL]: { ...NO_TAPE, query_date: '11/13/2026' }, [PAST_LIST_URL]: { ...NO_CONTRACTS, query_date: '11/13/2026' } })
    renderPanel({ date: PAST })
    await screen.findByTestId('terminal-accum-empty')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})

describe('ACCUM list alert', () => {
  it('mounts the "alert me" switch for the repeat-hit contracts list, outside the toolbar', async () => {
    serve({ [READ_URL]: DAY, [LIST_URL]: CONTRACTS })
    renderPanel()
    await screen.findByTestId('terminal-accum-table')
    const stub = screen.getByTestId('list-alert-stub')
    expect(stub.getAttribute('data-kind')).toBe('repeat_contracts')
    expect(stub.closest('[role="toolbar"]')).toBeNull()
  })
})
