// MYH: the member's own Journal record on one stock. Rails:
//   * PERSONAL DATA: exactly five reads, each one of the member's own `/api/j2/` routes; nothing
//     from the trader archive; an account goes into the command by its place in the list, never
//     by its id; a note's text is never drawn;
//   * ⭐ THE JOURNAL'S OWN NUMBERS: every stat on screen is the Journal's `summaryStats` over the
//     list its Trade Journal tab builds, printed as the Journal prints it; a row's R is the
//     Journal's R cell;
//   * no stop logged: a closed trade says "No stop logged" and is left out of the average R; an
//     open broker import shows no fake stop and no fake date;
//   * the unrealized result is the Journal's formula at the Journal's price, and is absent with
//     no price; an open option position never shows one;
//   * HONEST STATES: loading; a failed accounts read (error with Retry; signed out; locked); every
//     data read failing; each read failing APART (never "no trades", never "not held"); an empty
//     record with the two existing doors; a small sample marked in PERF's words;
//   * the account picker switches the reads and writes itself into `NVDA MYH 2`;
//   * Share reads only the closed-trade table: no live price and no note title can leave.
// The fixtures are the routes' real shapes with made-up trades (__fixtures__/myHistoryFixture.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: vi.fn() }))
vi.mock('../../../hooks/useBrokerMarkPreference', () => ({ default: vi.fn(() => false), useMarkPreferenceContext: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import useLivePrices from '../../../hooks/useLivePrices'
import { useMarkPreferenceContext } from '../../../hooks/useBrokerMarkPreference'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import {
  holdDaysDisplay, moneySigned, percent, positionPnlDollar, positionPnlPercent, rMultiple as journalR, summaryStats,
} from '../../../lib/journal-2-0'
import { optionClosedToRow } from '../../journal-2-0/lib/optionCalcs'
import MyHistoryPanel, {
  MY_HISTORY_CODE, historyValueText, notesUrl, optionsUrl, positionsUrl, tradesUrl,
} from './MyHistoryPanel'
import { ACCOUNTS_URL, JOURNAL_ACCOUNT_KEY } from './performanceModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { cellLines, readPanel } from '../share/shareRead'
import { shareClassOf, shareDecision } from '../share/shareRule'
import { BY_CODE } from '../functions'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'
import {
  CLOSED_CALL, EXPIRED_PUT, NOTES_BODY, NO_OPTIONS_BODY, NVDA_TRADES, ONE_ACCOUNT, OPEN_CALL, POSITIONS_BODY, TRADES_BODY, TWO_ACCOUNTS,
  note, position, trade,
} from './__fixtures__/myHistoryFixture'

const T1 = tradesUrl({ sym: 'NVDA', accountId: 'acc-1' })
const P1 = positionsUrl({ accountId: 'acc-1' })
const O1 = optionsUrl({ sym: 'NVDA', accountId: 'acc-1' })
const T2 = tradesUrl({ sym: 'NVDA', accountId: 'acc-2' })
const P2 = positionsUrl({ accountId: 'acc-2' })
const O2 = optionsUrl({ sym: 'NVDA', accountId: 'acc-2' })
const T_ALL = tradesUrl({ sym: 'NVDA' })
const P_ALL = positionsUrl()
const O_ALL = optionsUrl({ sym: 'NVDA' })
const N = notesUrl({ sym: 'NVDA' })
const NONE = { [T1]: { trades: [] }, [P1]: { positions: [] }, [O1]: NO_OPTIONS_BODY, [N]: { notes: [], total: 0 } }
const FULL = { [ACCOUNTS_URL]: ONE_ACCOUNT, [T1]: TRADES_BODY, [P1]: POSITIONS_BODY, [O1]: NO_OPTIONS_BODY, [N]: NOTES_BODY }

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
/** The live-price pool: `live` is `{ SYM: { price } }`; the tickers each call registered are kept. */
let registered = []
function livePrices(live = {}) {
  registered = []
  useLivePrices.mockImplementation((tickers = []) => {
    registered.push([...tickers])
    return { prices: Object.fromEntries(tickers.filter((t) => live[t]).map((t) => [t, live[t]])), isLoading: false, error: null, refresh: () => {} }
  })
}

let report = null
function renderPanel(props = {}, { open = vi.fn(), rerun = vi.fn(), code = null } = {}) {
  report = null
  const body = <MyHistoryPanel sym="NVDA" {...props} />
  const view = render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelFreshnessContext.Provider value={(r) => { if (r) report = r }}>
          <PanelListContext.Provider value={{ open, run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
            {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
          </PanelListContext.Provider>
        </PanelFreshnessContext.Provider>
      </SWRConfig>
    </MemoryRouter>,
  )
  return { open, rerun, container: view.container }
}
const stat = (key) => screen.getByTestId(`terminal-myh-stat-${key}`)
const statText = (key) => stat(key).textContent
const tradeCells = () => screen.getAllByTestId('terminal-myh-trade-row').map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => {
  jsonFetcher.mockReset()
  window.localStorage.clear()
  livePrices({ NVDA: { price: 131.2 } })
  useMarkPreferenceContext.mockReturnValue({ sessionClosed: false, lastClosedSessionET: '2026-11-13' })
})
afterEach(cleanup)

describe('MYH: the record on one stock', () => {
  it('shows what is held, the closed trades with the Journal\'s numbers, and the newest notes', async () => {
    serve(FULL)
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    expect(screen.getByTestId('terminal-myh').getAttribute('data-sym')).toBe('NVDA')
    expect(screen.getByTestId('terminal-myh-account').textContent).toBe('Account: Default.')
    expect(screen.queryByTestId('terminal-myh-account-pick')).toBeNull()
    expect(screen.getByTestId('terminal-myh-summary').textContent).toBe('You hold NVDA now. 5 closed trades on it. 2 notes name it.')

    // held now: the position, its real stop, its date and the Journal's unrealized result
    const held = screen.getAllByTestId('terminal-myh-holding-row')
    expect(held).toHaveLength(1)
    expect(held[0].textContent).toContain('Long, 100 shares')
    expect(screen.getByTestId('terminal-myh-holding-entry').textContent).toBe('Average entry $120.50')
    expect(screen.getByTestId('terminal-myh-holding-stop').textContent).toBe('Stop $115.00')
    expect(screen.getByTestId('terminal-myh-holding-date').textContent).toBe('Opened 11/10/26')
    expect(screen.getByTestId('terminal-myh-holding-result').textContent).toBe('Unrealized +$1,070.00 (+8.88%) at $131.20, the live price')

    // the numbers
    expect(statText('trades')).toBe('Closed trades53 wins, 1 loss, 1 breakeven')
    expect(statText('winRate')).toBe('Win rate75.0%Small sample: 4 wins and losses, 10 needed.')
    expect(statText('total')).toBe('Total result+$1,590.00Before fees.')
    expect(statText('average')).toBe('Average result per trade+$318.00Small sample: 5 trades, 10 needed.')
    expect(statText('averageR')).toBe('Average R+0.80RSmall sample: 4 trades with a known R, 10 needed.')
    expect(statText('best')).toBe('Best trade+$1,000.00')
    expect(statText('worst')).toBe('Worst trade-$350.00')
    expect(statText('hold')).toBe('Average hold4.0 daysSmall sample: 5 trades, 10 needed.')
    expect(stat('winRate').getAttribute('data-state')).toBe('thin')
    expect(screen.getByTestId('terminal-myh-r-coverage').textContent).toBe('R is known for 4 of 5 trades. 1 stock trade has no stop logged (a broker import carries none), so it has no R and is left out of the average, never counted as zero.')

    // the trades, newest close first: the dates, the trade with its entry and exit, result, R, setup
    expect(screen.getByTestId('terminal-myh-trades-table').getAttribute('aria-label')).toBe('Your closed trades on NVDA, newest close first, 5 trades')
    expect(tradeCells()).toEqual([
      ['11/12/26opened 11/08/26', 'Long, 40 shares$160.00 to $171.00', '+$440.00', 'No stop logged', 'No setup tag'],
      ['11/06/26opened 11/05/26', 'Long, 60 shares$150.00 to $150.00', '$0.00', '0.0R', 'No setup tag'],
      ['11/03/26opened 10/29/26', 'Long, 80 shares$125.00 to $131.25', '+$500.00', '+2.6R', 'Breakout'],
      ['10/20/26opened 10/17/26', 'Long, 50 shares$140.00 to $133.00', '-$350.00', '-1.4R', 'Pullback'],
      ['10/08/26opened 10/01/26', 'Long, 100 shares$120.00 to $130.00', '+$1,000.00', '+2.0R', 'Breakout'],
    ])
    expect(screen.queryByTestId('terminal-myh-trades-all')).toBeNull()

    // the notes: a title, a date and a link into the Notebook; never the note's text
    const notes = within(screen.getByTestId('terminal-myh-notes-list')).getAllByRole('link')
    expect(notes.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['NVDA plan into earnings', '/journal/notebook?note=n2'], ['Why I sold NVDA too early', '/journal/notebook?note=n1'],
    ])
    expect(screen.getByTestId('terminal-myh-notes').textContent).toContain('Last edited 11/14/26')
    expect(document.body.textContent).not.toContain('made-up preview text')
    expect(screen.queryByTestId('terminal-myh-notes-more')).toBeNull()

    expect(report).toMatchObject({ source: 'Your journal' })
    expect(screen.getByTestId('terminal-myh-method').textContent).toContain('These are your own records, read from your Journal (Default).')
  })

  it('⭐ every number on screen is the Journal\'s own: summaryStats over the Trade Journal tab\'s union, printed its way', async () => {
    serve({ ...FULL, [O1]: { strategies: [CLOSED_CALL] } })
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    // the union as tabs/TradeJournalTab.jsx builds it: the stock trades of the ticker, then its closed strategies
    const union = [...NVDA_TRADES, ...[CLOSED_CALL].map(optionClosedToRow)]
    const want = summaryStats(union)
    expect(want.totalTrades).toBe(6)
    expect(stat('trades').querySelector('span').textContent).toBe(String(want.totalTrades))
    expect(statText('trades')).toContain(`${want.wins} wins, ${want.losses} loss, ${want.bes} breakeven`)
    expect(stat('winRate').querySelector('span').textContent).toBe(percent(want.winRate, { dp: 1, isRatio: false }))
    expect(stat('total').querySelector('span').textContent).toBe(moneySigned(want.totalPnl))
    expect(stat('average').querySelector('span').textContent).toBe(moneySigned(want.avgPnlPerTrade))
    expect(stat('best').querySelector('span').textContent).toBe(moneySigned(want.largestWin))
    expect(stat('worst').querySelector('span').textContent).toBe(moneySigned(want.largestLoss))
    expect(stat('hold').querySelector('span').textContent).toBe(holdDaysDisplay(want.avgHold).replace(/d$/, ' days'))
    // each row's result and R are the Journal's own cells for that trade
    const byResult = new Map(union.map((t) => [moneySigned(t.pnlDollar), t]))
    for (const cells of tradeCells()) {
      const t = byResult.get(cells[2])
      expect(t, cells.join(' | ')).toBeTruthy()
      expect(cells[3]).toBe(t.rMultiple === null ? 'No stop logged' : journalR(t.rMultiple))
    }
    expect(screen.getByTestId('terminal-myh-mix').textContent).toContain('1 of the 6 is an option trade')
    expect(statText('total')).toContain('Stock trades before fees, option trades after.')
  })

  it('asks exactly five of the member\'s own Journal routes, and nothing else', async () => {
    serve(FULL)
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    expect([...new Set(asked())].sort()).toEqual([ACCOUNTS_URL, T1, P1, O1, N].sort())
    expect(T1).toBe('/api/j2/trades?symbol=NVDA&account_id=acc-1')
    expect(N).toBe('/api/j2/notes?ticker=NVDA&limit=5&excludeSample=1')
    for (const url of asked()) {
      expect(url.startsWith('/api/j2/'), url).toBe(true)
      expect(url).not.toMatch(/wisdom|archive|user_id|member/i)
    }
    // the one live number: this stock's price, and only because a stock position is held
    expect(registered.flat()).toContain('NVDA')
    expect(new Set(registered.flat())).toEqual(new Set(['NVDA']))
  })

  it('needs a ticker, and says how to give one', () => {
    serve(FULL)
    renderPanel({ sym: '' })
    expect(screen.getByText(`${MY_HISTORY_CODE} needs a ticker.`)).toBeTruthy()
    expect(asked()).toEqual([])
  })

  it('a long record shows the newest 20 until asked; the numbers always count them all', async () => {
    const many = Array.from({ length: 23 }, (_, i) => trade(`m${i}`, {
      exitDate: `2026-${String(1 + Math.floor(i / 2)).padStart(2, '0')}-${String(10 + (i % 2)).padStart(2, '0')}T16:00:00+00:00`,
      result: i % 4 ? 'Win' : 'Loss', pnlDollar: i % 4 ? 100 : -50,
    }))
    serve({ ...FULL, [T1]: { trades: many } })
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    expect(screen.getAllByTestId('terminal-myh-trade-row')).toHaveLength(20)
    expect(statText('trades')).toContain('Closed trades23')
    expect(statText('winRate')).toBe('Win rate73.9%From 23 wins and losses.')
    expect(stat('winRate').getAttribute('data-state')).toBe('ok')
    const more = screen.getByTestId('terminal-myh-trades-all')
    expect(more.textContent).toBe('Show all 23 trades')
    fireEvent.click(more)
    expect(screen.getAllByTestId('terminal-myh-trade-row')).toHaveLength(23)
    expect(more.textContent).toBe('Show the newest 20')
  })
})

describe('MYH: no stop logged, no fake date, no invented result', () => {
  it('a broker import held now shows no stop and an estimated date, marked at the broker\'s price when no live price exists', async () => {
    livePrices({})
    serve({ ...FULL, [P1]: { positions: [position('b1', { source: 'broker', stopPrice: 120.5, entryEstimated: true, brokerPrice: 129.0 })] } })
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    expect(screen.getByTestId('terminal-myh-holding-stop').textContent).toBe('No stop logged')
    expect(screen.getByTestId('terminal-myh-holding-date').textContent).toBe('Entry date estimated (imported from your broker)')
    expect(screen.getByTestId('terminal-myh-holding-result').textContent).toBe('Unrealized +$850.00 (+7.05%) at $129.00, your broker\'s last price')
    expect(screen.getByTestId('terminal-myh-holding').textContent).not.toMatch(/Stop \$|Opened \d/)
  })

  it('the unrealized result is the Journal\'s formula at the Journal\'s price; once the session has closed that is the broker\'s mark', async () => {
    const held = position('b2', { accountId: 'acc-2', source: 'broker', stopPrice: 120.5, brokerPrice: 129.0 })
    useMarkPreferenceContext.mockReturnValue({ sessionClosed: true, lastClosedSessionET: '2026-11-13' })
    window.localStorage.setItem(JOURNAL_ACCOUNT_KEY, 'acc-2')
    serve({ [ACCOUNTS_URL]: TWO_ACCOUNTS, [T2]: { trades: [] }, [P2]: { positions: [held] }, [O2]: NO_OPTIONS_BODY, [N]: { notes: [], total: 0 } })
    renderPanel()
    await screen.findByTestId('terminal-myh-holding-result')
    // acc-2's balance sync covers that close, so the Journal's own rule prefers the broker's mark over the live 131.20
    const want = `Unrealized ${moneySigned(positionPnlDollar(held, 129.0))} (${percent(positionPnlPercent(held, 129.0), { signed: true, dp: 2 })}) at $129.00, your broker's last price`
    expect(screen.getByTestId('terminal-myh-holding-result').textContent).toBe(want)
    expect(screen.getByTestId('terminal-myh-account').textContent).toBe('Showing Broker account. It is linked to your broker.')
  })

  it('with no price at all there is no unrealized result, never a zero', async () => {
    livePrices({})
    serve(FULL)
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    expect(screen.getByTestId('terminal-myh-holding-result').textContent).toBe('No current price to mark it with just now, so no unrealized result is shown.')
    expect(screen.getByTestId('terminal-myh-holding').textContent).not.toContain('$0.00')
  })

  it('an open option position shows its contracts and entry, never a result of this panel\'s making', async () => {
    serve({ ...FULL, [P1]: { positions: [] }, [O1]: { strategies: [OPEN_CALL, EXPIRED_PUT] } })
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    const row = screen.getByTestId('terminal-myh-holding-row')
    expect(row.getAttribute('data-kind')).toBe('option')
    expect(row.textContent).toContain(optionClosedToRow(OPEN_CALL).symbol)
    expect(row.textContent).toContain('Long Call, 2 contracts')
    expect(row.textContent).toContain('Entry premium $4.20')
    expect(row.textContent).not.toMatch(/Unrealized/)
    expect(screen.getByTestId('terminal-myh-options-result').textContent).toContain('its current result is on the Journal\'s Open Positions tab')
    // no stock position, so no live price is asked for
    expect(registered.flat()).toEqual([])
    // an option that expired is not in the Journal's trade list: it is said, never silently counted or dropped
    expect(statText('trades')).toContain('Closed trades5')
    expect(screen.getByTestId('terminal-myh-options-other').textContent).toContain('1 option trade on NVDA expired, was assigned or was rolled.')
  })
})

describe('MYH: honest states', () => {
  it('loading, then the record', async () => {
    serve({ ...FULL, [ACCOUNTS_URL]: PENDING })
    renderPanel()
    expect(screen.getByTestId('terminal-myh-loading').textContent).toContain('Loading your history on NVDA')
    cleanup()
    serve({ [ACCOUNTS_URL]: ONE_ACCOUNT, [T1]: PENDING, [P1]: PENDING, [O1]: PENDING, [N]: PENDING })
    renderPanel()
    expect(await screen.findByTestId('terminal-myh-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-myh-empty')).toBeNull()
  })

  it('a failed accounts read is an error with Retry, never an empty record', async () => {
    serve({ ...FULL, [ACCOUNTS_URL]: fail(500) })
    renderPanel()
    const err = await screen.findByTestId('terminal-myh-error')
    expect(err.textContent).toContain('Your journal could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no trades or notes. Retry, or run NVDA MYH again.')
    expect(screen.queryByTestId('terminal-myh-empty')).toBeNull()
    serve(FULL)
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('terminal-myh-trades-table')
  })

  it('signed out and locked say so; an answer that is not an accounts list is an error', async () => {
    serve({ [ACCOUNTS_URL]: fail(401) })
    renderPanel()
    expect((await screen.findByTestId('terminal-myh-error')).textContent).toContain('You are signed out, so your journal cannot be read. Sign in again.')
    cleanup()
    serve({ [ACCOUNTS_URL]: fail(402) })
    renderPanel()
    const locked = await screen.findByTestId('terminal-myh-error')
    expect(locked.getAttribute('data-kind')).toBe('locked')
    expect(within(locked).queryByRole('button')).toBeNull()
    cleanup()
    serve({ [ACCOUNTS_URL]: { detail: 'nope' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-myh-error')).textContent).toContain('Your journal could not be read just now.')
    cleanup()
    serve({ [ACCOUNTS_URL]: { accounts: [] } })
    renderPanel()
    expect((await screen.findByTestId('terminal-myh-no-account')).textContent).toContain('You have no journal account yet.')
  })

  it('every data read failing is one error with Retry, not an empty record', async () => {
    serve({ [ACCOUNTS_URL]: ONE_ACCOUNT })   // the four data reads answer 500
    renderPanel()
    const err = await screen.findByTestId('terminal-myh-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('That is not the same as no trades or notes.')
    expect(screen.queryByTestId('terminal-myh-empty')).toBeNull()
    serve(FULL)
    fireEvent.click(within(err).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('terminal-myh-trades-table')
  })

  it('⛔ the trades read failing is never "no closed trades": the rest is still drawn', async () => {
    serve({ ...FULL, [T1]: fail(500) })
    renderPanel()
    const note = await screen.findByTestId('terminal-myh-trades-error')
    expect(note.textContent).toContain('Your closed trades could not be read just now. That is not the same as no trades.')
    expect(screen.queryByTestId('terminal-myh-closed-none')).toBeNull()
    expect(screen.queryByTestId('terminal-myh-stats')).toBeNull()
    expect(screen.queryByTestId('terminal-myh-empty')).toBeNull()
    expect(screen.getByTestId('terminal-myh-summary').textContent).toBe('You hold NVDA now. 2 notes name it.')
    expect(screen.getAllByTestId('terminal-myh-holding-row')).toHaveLength(1)
    expect(within(screen.getByTestId('terminal-myh-notes-list')).getAllByRole('link')).toHaveLength(2)
    serve(FULL)
    fireEvent.click(within(note).getByRole('button', { name: 'Retry your closed trades' }))
    await screen.findByTestId('terminal-myh-trades-table')
    expect(screen.queryByTestId('terminal-myh-trades-error')).toBeNull()
  })

  it('⛔ the positions read failing is never "you do not hold it"', async () => {
    serve({ ...FULL, [P1]: fail(503) })
    renderPanel()
    const note = await screen.findByTestId('terminal-myh-positions-error')
    expect(note.textContent).toContain('Your open positions could not be read just now. That is not the same as not holding NVDA.')
    await screen.findByTestId('terminal-myh-trades-table')
    expect(screen.getByTestId('terminal-myh-holding').textContent).not.toContain('You do not hold')
    expect(screen.getByTestId('terminal-myh-summary').textContent).toBe('5 closed trades on it. 2 notes name it.')
    // what WAS read is said for what it is: the options answer holds no open option position
    expect(screen.getByTestId('terminal-myh-holding-none').textContent).toBe('No open option position on NVDA.')
  })

  it('the options read failing marks the numbers as stock trades only; the notes read failing is never "no notes"', async () => {
    serve({ ...FULL, [O1]: fail(500), [N]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    expect(screen.getByTestId('terminal-myh-options-error').textContent).toContain('Your option trades could not be read just now.')
    expect(screen.getByTestId('terminal-myh-stock-only').textContent).toBe('These numbers are your stock trades only: your option trades on NVDA could not be read.')
    expect(statText('trades')).toContain('Closed trades5')
    expect(screen.getByTestId('terminal-myh-notes-error').textContent).toContain('Your notes could not be read just now. That is not the same as no notes.')
    expect(screen.queryByTestId('terminal-myh-notes-none')).toBeNull()
    expect(screen.getAllByTestId('terminal-myh-holding-row')).toHaveLength(1)
  })

  it('a trades answer that is not a list is a failed read too', async () => {
    serve({ ...FULL, [T1]: { detail: 'Not authenticated' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-myh-trades-error')).textContent).toContain('Your closed trades could not be read just now.')
    expect(screen.queryByTestId('terminal-myh-closed-none')).toBeNull()
  })

  it('an empty record says so, with the two doors the terminal already has', async () => {
    serve({ [ACCOUNTS_URL]: ONE_ACCOUNT, ...NONE })
    const { open } = renderPanel()
    const empty = await screen.findByTestId('terminal-myh-empty')
    expect(empty.textContent).toContain('You have no trades or notes on NVDA yet.')
    expect(empty.textContent).toContain('Log a trade in the Journal (JRNL), or write a note in the Notebook (NB).')
    fireEvent.click(within(empty).getByRole('button', { name: /Open the Journal/ }))
    expect(open).toHaveBeenLastCalledWith('JRNL')
    fireEvent.click(within(empty).getByRole('button', { name: /Open the Notebook/ }))
    expect(open).toHaveBeenLastCalledWith('NB')
    expect(registered.flat()).toEqual([])
  })

  it('notes but no trades, and trades but no notes, each say what is missing', async () => {
    serve({ [ACCOUNTS_URL]: ONE_ACCOUNT, ...NONE, [N]: { notes: [note('n9', 'One idea', '2026-11-01T15:00:00+00:00')], total: 7 } })
    renderPanel()
    expect((await screen.findByTestId('terminal-myh-closed-none')).textContent).toBe('No closed trades on NVDA yet.')
    expect(screen.getByTestId('terminal-myh-holding-none').textContent).toBe('You do not hold NVDA now: no open stock position and no open option position.')
    expect(screen.getByTestId('terminal-myh-summary').textContent).toBe('You do not hold NVDA now. No closed trades on it. 7 notes name it.')
    const more = screen.getByTestId('terminal-myh-notes-more')
    expect(more.textContent).toContain('Showing the 1 edited most recently, of 7.')
    expect(within(more).getByRole('button').getAttribute('aria-label')).toBe('Your research notes on NVDA (NVDA RSCH)')
    cleanup()
    serve({ ...FULL, [N]: { notes: [], total: 0 } })
    renderPanel()
    expect((await screen.findByTestId('terminal-myh-notes-none')).textContent).toBe('No note names NVDA yet. Write one in the Notebook (NB).')
  })

  it('one winning trade: every ratio is shown with its sample and marked small, in PERF\'s words', async () => {
    serve({ ...FULL, [T1]: { trades: [trade('only')] } })
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    expect(statText('winRate')).toBe('Win rate100.0%Small sample: 1 win or loss, 10 needed.')
    expect(statText('average')).toBe('Average result per trade+$1,000.00Small sample: 1 trade, 10 needed.')
    expect(statText('averageR')).toBe('Average R+2.00RSmall sample: 1 trade with a known R, 10 needed.')
    expect(statText('worst')).toBe('Worst tradeNo losing trade yet.')
    expect(stat('worst').getAttribute('data-state')).toBe('none')
    expect(statText('hold')).toBe('Average hold7.0 daysSmall sample: 1 trade, 10 needed.')
  })
})

describe('MYH: the account', () => {
  const BOTH = {
    [ACCOUNTS_URL]: TWO_ACCOUNTS, [T1]: TRADES_BODY, [P1]: POSITIONS_BODY, [O1]: NO_OPTIONS_BODY, [N]: NOTES_BODY,
    [T2]: { trades: [trade('z1', { accountId: 'acc-2' })] }, [P2]: { positions: [] }, [O2]: NO_OPTIONS_BODY,
    [T_ALL]: { trades: [...NVDA_TRADES, trade('z1', { accountId: 'acc-2' })] }, [P_ALL]: POSITIONS_BODY, [O_ALL]: NO_OPTIONS_BODY,
  }

  it('starts on the Journal\'s own pick, and the picker switches the reads (PERF\'s picker, PERF\'s words)', async () => {
    serve(BOTH)
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    expect(screen.getByTestId('terminal-myh-account').textContent).toBe('Showing Default.')
    const pick = screen.getByTestId('terminal-myh-account-pick')
    expect([...pick.options].map((o) => o.textContent)).toEqual(['Default', 'Broker account', 'All accounts together'])
    fireEvent.change(pick, { target: { value: '2' } })
    await waitFor(() => expect(statText('trades')).toContain('Closed trades1'))
    expect(screen.getByTestId('terminal-myh-account').textContent).toBe('Showing Broker account. It is linked to your broker.')
    expect(screen.getByTestId('terminal-myh-holding-none').textContent).toBe('You do not hold NVDA now in Broker account: no open stock position and no open option position.')
    expect(asked()).toEqual(expect.arrayContaining([T2, P2, O2]))
    fireEvent.change(pick, { target: { value: 'ALL' } })
    await waitFor(() => expect(statText('trades')).toContain('Closed trades6'))
    expect(screen.getByTestId('terminal-myh-account').textContent).toBe('Showing All accounts together.')
    expect(screen.getByTestId('terminal-myh').getAttribute('data-account')).toBe('all')
    // across accounts, a holding says which account it is in
    expect(screen.getByTestId('terminal-myh-holding-row').textContent).toContain('in Default')
    // the picker never moves the Journal's own pick
    expect(window.localStorage.getItem(JOURNAL_ACCOUNT_KEY)).toBeNull()
  })

  it('a typed account wins over the Journal\'s pick; one the list does not have says so', async () => {
    serve(BOTH)
    window.localStorage.setItem(JOURNAL_ACCOUNT_KEY, 'acc-2')
    renderPanel({ account: 'all' })
    await waitFor(() => expect(statText('trades')).toContain('Closed trades6'))
    cleanup()
    renderPanel({ account: 5 })
    await waitFor(() => expect(statText('trades')).toContain('Closed trades1'))
    expect(screen.getByTestId('terminal-myh-missing').textContent).toBe('You have no account number 5 (2 in your Journal), so this shows Broker account.')
  })

  it('inside the terminal the picker writes itself into the command, with the ticker and never an account id', async () => {
    serve(BOTH)
    const { rerun } = renderPanel({}, { code: 'MYH' })
    await screen.findByTestId('terminal-myh-trades-table')
    fireEvent.change(screen.getByTestId('terminal-myh-account-pick'), { target: { value: '2' } })
    expect(rerun).toHaveBeenLastCalledWith('NVDA MYH 2')
    fireEvent.change(screen.getByTestId('terminal-myh-account-pick'), { target: { value: 'ALL' } })
    expect(rerun).toHaveBeenLastCalledWith('NVDA MYH ALL')
    expect(rerun.mock.calls.flat().join(' ')).not.toContain('acc-')
    await waitFor(() => expect(statText('trades')).toContain('Closed trades6'))
  })

  it('links its neighbours for the same stock, and PERF for every stock', async () => {
    serve(FULL)
    const { open } = renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    const method = screen.getByTestId('terminal-myh-method')
    for (const [name, cmd] of [[/Open your trading stats/, 'PERF'], [/Pre-trade check \(CHK\) for NVDA/, 'NVDA CHK'], [/Trade plan \(PLAN\) for NVDA/, 'NVDA PLAN']]) {
      fireEvent.click(within(method).getByRole('button', { name }))
      expect(open).toHaveBeenLastCalledWith(cmd)
    }
  })
})

describe('MYH: what Share can read', () => {
  const styleAt = (phone) => (el) => {
    const cls = typeof el.className === 'string' ? el.className : ''
    return { display: phone && /phoneHide/.test(cls) ? 'none' : '', visibility: '', color: '', textAlign: '', fontWeight: '' }
  }
  const heads = (t) => t.columns.map((c) => c.text)

  it('is classed as the member\'s own records, and is offered', () => {
    expect(shareClassOf('MYH')).toBe('own')
    expect(shareDecision(BY_CODE.MYH, BY_CODE.MYH.ticker)).toMatchObject({ offered: true, image: true, file: true, cls: 'own' })
  })

  it('⛔ only the closed-trade table is read: no live price, no holding and no note title can leave', async () => {
    serve(FULL)
    const { container } = renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    expect(container.querySelectorAll('table')).toHaveLength(1)
    const out = readPanel(container, { getStyle: styleAt(false) })
    expect(out.tables).toHaveLength(1)
    expect(heads(out.tables[0])).toEqual(['Closed', 'Trade', 'Result', 'R', 'Setup'])
    expect(out.rowCount).toBe(5)
    expect(out.tables[0].rows[0].cells.map((c) => cellLines(c))).toEqual([
      ['11/12/26', 'opened 11/08/26'], ['Long, 40 shares', '$160.00 to $171.00'], ['+$440.00'], ['No stop logged'], ['No setup tag'],
    ])
    const shared = JSON.stringify(out)
    expect(shared).not.toContain('131.20')
    expect(shared).not.toMatch(/Unrealized|live price|NVDA plan into earnings|Why I sold/)
  })

  it('on a phone the table keeps the date, the result and R', async () => {
    serve(FULL)
    const { container } = renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    expect(heads(readPanel(container, { getStyle: styleAt(true) }).tables[0])).toEqual(['Closed', 'Result', 'R'])
  })
})

describe('MYH: the look, and accessibility', () => {
  it('printing is pure: a stat with no value prints nothing, never a zero', () => {
    expect(historyValueText(null)).toBeNull()
    expect(historyValueText({ kind: 'pct', value: null })).toBeNull()
    expect(historyValueText({ kind: 'r', value: -0.004 })).toBe('0.00R')
    expect(historyValueText({ kind: 'r', value: -1.256 })).toBe('-1.26R')
    expect(historyValueText({ kind: 'signedUsd', value: 0 })).toBe('$0.00')
    expect(historyValueText({ kind: 'days', value: 1 })).toBe('1.0 days')
    expect(historyValueText({ kind: 'count', value: 1234 })).toBe('1,234')
  })

  it('the panel, its model and its fixtures hold no hard-coded color, and add no stylesheet', () => {
    for (const f of ['MyHistoryPanel.jsx', 'myHistoryModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
    const panel = fs.readFileSync(path.join(HERE, 'MyHistoryPanel.jsx'), 'utf8')
    expect([...panel.matchAll(/from '(\.\/[^']+\.module\.css)'/g)].map((m) => m[1]).sort()).toEqual(['./marketPanels.module.css', './performancePanel.module.css'])
  })

  it('the full record, the thin record and the empty record pass axe (WCAG A and AA)', async () => {
    serve({ ...FULL, [O1]: { strategies: [OPEN_CALL, CLOSED_CALL, EXPIRED_PUT] } })
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [ACCOUNTS_URL]: TWO_ACCOUNTS, ...NONE })
    renderPanel()
    await screen.findByTestId('terminal-myh-empty')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ ...FULL, [T1]: fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-myh-trades-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 30_000)
})
