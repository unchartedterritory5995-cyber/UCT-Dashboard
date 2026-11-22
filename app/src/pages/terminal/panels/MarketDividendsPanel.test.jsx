// DVD MARKET: every ex-dividend date and split this week and next for the stocks the site follows. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan (locked, no Retry), a timeout and
//     an answer that is not the route's shape: none of them is "no dividends";
//   * "computing" is said in words and the panel asks again every 3 seconds on its own;
//   * the server's own failed read (neither list answered) is said, with Retry, never as empty;
//   * an answered, empty list is an answer;
//   * the count line, this week's and next week's ex-dividend tables by day, each stock with its name, the
//     cash amount (never $0 when missing; another currency by its code), how often, the pay and declared
//     days; the splits by the day they take effect, a reverse split said;
//   * one list failing, a stale week, a failed later look, a cut list and dropped rows are each said;
//   * what the feed lists for stocks the site does not follow is counted, not listed;
//   * every symbol loads through the kit; the "Your stocks" chip writes `DVD` back (or switches in state);
//   * the source and read time in words; no hard-coded color; axe.
// Every symbol, name, date and amount is invented.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2031-03-12' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import MarketDividendsPanel from './MarketDividendsPanel'
import DividendCalendarPanel from './DividendCalendarPanel'
import { DVD_MARKET_SOURCE, DVD_MARKET_URL } from './marketDividendsModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const dv = (sym, ex, over = {}) => ({ sym, name: `${sym.slice(-1)} Quarry Works`, ex_date: ex, amount: 0.25, currency: 'USD', frequency: 4,
  type: 'CD', pay_date: '2031-03-28', declared_date: '2031-02-20', record_date: ex, ...over })
const sp = (sym, date, ratio, over = {}) => ({ sym, name: null, date, split_from: 1, split_to: 4, ratio, reverse: false, ...over })
const BODY = (over = {}) => ({
  status: 'ok', window: { from: '2031-03-10', to: '2031-03-23' }, current_window: { from: '2031-03-10', to: '2031-03-23' },
  stale_window: false, read_at: '2031-03-12T14:02:00+00:00', source: DVD_MARKET_SOURCE, check: null,
  dividends: [
    dv('QQZA', '2031-03-11', { amount: 1.05, frequency: 12 }),
    dv('QQZC', '2031-03-11', { amount: null, frequency: 0, type: 'SC', pay_date: null, declared_date: null, name: null }),
    dv('QQZF', '2031-03-12', { amount: 0.45, currency: 'CAD' }),
    dv('QQZB', '2031-03-18'),
  ],
  splits: [sp('QQZE', '2031-03-13', '1:10', { reverse: true }), sp('QQZD', '2031-03-19', '4:1')],
  legs: { dividends: 'ok', splits: 'ok' },
  counts: { dividends: 4, splits: 2, not_followed_dividends: 37, not_followed_splits: 2 },
  cut: { dividends: false, splits: false }, dropped: { dividends: 0, splits: 0 }, caps: { dividends: 2000, splits: 300 },
  ...over,
})
const httpError = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status, ...extra })
const PENDING = Symbol('pending')
function serve(body) {
  jsonFetcher.mockImplementation((u) => {
    if (u !== DVD_MARKET_URL) return Promise.reject(httpError(500))
    const hit = typeof body === 'function' ? body() : body
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
function renderPanel(el = <MarketDividendsPanel />, { code = null, rerun = vi.fn(), run = vi.fn(), setFreshness = vi.fn() } = {}) {
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{el}</TerminalPanelContext.Provider> : el}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { rerun, run, setFreshness, container: view.container }
}
const frame = () => screen.getByTestId('terminal-dvd-market')
const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)
const noTables = () => !screen.queryByTestId('terminal-dvd-market-this') && !screen.queryByTestId('terminal-dvd-market-splits')
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('DVD MARKET states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve(PENDING)
    renderPanel()
    expect(screen.getByTestId('terminal-dvd-market-loading').textContent).toContain('Loading the market dividend calendar')
    expect(jsonFetcher.mock.calls.map(([u]) => u)).toEqual([DVD_MARKET_URL])
  })

  it('a failed read is an error with Retry, never "no dividends", and a retry that works fills in', async () => {
    serve(httpError(500))
    const { setFreshness } = renderPanel()
    const err = await screen.findByTestId('terminal-dvd-market-error')
    expect(frame().getAttribute('data-state')).toBe('error')
    expect(err.textContent).toContain('The market dividend calendar could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no dividends.')
    expect(noTables()).toBe(true)
    expect(noDated(setFreshness)).toBe(true)
    serve(BODY())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-dvd-market-this')).toBeTruthy()
  })

  it('signed out, a timeout and no paid plan each say so; only an error can be retried', async () => {
    for (const [hit, kind, words] of [
      [httpError(401), 'error', 'You are signed out, so the market dividend calendar cannot be read. Sign in again.'],
      [httpError(0, { timedOut: true }), 'error', 'The market dividend calendar did not answer within 30 seconds.'],
      [httpError(402), 'locked', 'The market dividend calendar needs a paid plan.'],
      [{ status: 'ok', dividends: 'x' }, 'error', 'The market dividend calendar came back in a shape this panel cannot read.'],
    ]) {
      serve(hit)
      renderPanel()
      const box = await screen.findByTestId('terminal-dvd-market-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      expect(noTables(), words).toBe(true)
      cleanup()
    }
  })

  it('"computing" is said in words, and the panel asks again every 3 seconds until it fills in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let body = { status: 'computing', source: DVD_MARKET_SOURCE }
    serve(() => body)
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-dvd-market-computing')
    expect(frame().getAttribute('data-state')).toBe('computing')
    expect(box.getAttribute('role')).toBe('status')
    expect(box.textContent).toContain('Loading, the server is preparing this.')
    expect(box.textContent).toContain('This panel asks again every 3 seconds')
    expect(noDated(setFreshness)).toBe(true)
    const before = jsonFetcher.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    expect(jsonFetcher.mock.calls.length).toBeGreaterThan(before)
    body = BODY()
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    await waitFor(() => expect(screen.getByTestId('terminal-dvd-market-this')).toBeTruthy())
    const held = jsonFetcher.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(jsonFetcher.mock.calls.length).toBe(held)
  })

  it('the server\'s own failed read is said with Retry, never as an empty list', async () => {
    serve({ status: 'failed', reason: 'source', http_status: null, source: DVD_MARKET_SOURCE })
    renderPanel()
    const box = await screen.findByTestId('terminal-dvd-market-unavailable')
    expect(box.textContent).toContain('The market dividend calendar could not be read from the data vendor just now.')
    expect(box.textContent).toContain('That is not the same as no dividends.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(noTables()).toBe(true)
  })

  it('an answered, empty list is an answer, with the source', async () => {
    serve(BODY({ dividends: [], splits: [], counts: { not_followed_dividends: 3 } }))
    renderPanel()
    const none = await screen.findByTestId('terminal-dvd-market-none')
    expect(none.textContent).toContain('No ex-dividend date or split is listed for the stocks the site follows, Mon Mar 10 to Sun Mar 23.')
    expect(none.textContent).toContain('That is an answer, not a failed read.')
    expect(screen.getByTestId('terminal-dvd-market-method').textContent).toContain('The feed also lists 3 ex-dividend dates')
  })
})

describe('DVD MARKET the list', () => {
  it('the count line, this week and next by ex-date, each stock with its name, cash, how often and days', async () => {
    serve(BODY())
    const r = renderPanel()
    expect((await screen.findByTestId('terminal-dvd-market-count')).textContent)
      .toBe('4 ex-dividend dates and 2 splits for the stocks the site follows, Mon Mar 10 to Sun Mar 23.')
    const thisWeek = screen.getByTestId('terminal-dvd-market-this')
    expect(thisWeek.getAttribute('aria-label')).toBe('This week: ex-dividend dates across the market, soonest day first, 3 dividends')
    expect([...thisWeek.querySelectorAll('th[scope="rowgroup"]')].map((th) => th.textContent))
      .toEqual(['Ex-dividend Tue Mar 11', 'Ex-dividend Wed Mar 12 (today)'])
    const rows = within(thisWeek).getAllByTestId('terminal-dvd-market-row')
    expect(cells(rows[0])).toEqual(['QQZAA Quarry Works', '$1.05Monthly', 'Pays Fri Mar 28Declared Thu Feb 20'])
    expect(cells(rows[1])).toEqual(['QQZC', 'Amount not givenSpecial, one-time', 'Pay date not given'])
    expect(cells(rows[2])[1]).toBe('0.45 CADQuarterly')
    const next = within(screen.getByTestId('terminal-dvd-market-next')).getAllByTestId('terminal-dvd-market-row')
    expect(cells(next[0])[0]).toBe('QQZBB Quarry Works')
    // the header names the source and the read time (the feed has no as-of of its own)
    expect(lastReport(r.setFreshness)).toMatchObject({ source: DVD_MARKET_SOURCE })
  })

  it('splits are listed on the day they take effect, a reverse split said', async () => {
    serve(BODY())
    renderPanel()
    const table = await screen.findByTestId('terminal-dvd-market-splits')
    expect([...table.querySelectorAll('th[scope="rowgroup"]')].map((th) => th.textContent))
      .toEqual(['Takes effect Thu Mar 13', 'Takes effect Wed Mar 19'])
    const rows = within(table).getAllByTestId('terminal-dvd-market-split-row')
    expect(rows.map(cells)).toEqual([['QQZE', '1 for 10 (reverse split)'], ['QQZD', '4 for 1']])
  })

  it('no split ahead is said; a failed splits read is said instead, never as none', async () => {
    serve(BODY({ splits: [] }))
    renderPanel()
    expect((await screen.findByTestId('terminal-dvd-market-splits-none')).textContent).toContain('No split takes effect')
    cleanup()
    serve(BODY({ splits: [], legs: { dividends: 'ok', splits: 'failed' } }))
    renderPanel()
    expect((await screen.findByTestId('terminal-dvd-market-leg')).textContent).toContain('That is not the same as no splits.')
    expect(screen.queryByTestId('terminal-dvd-market-splits-none')).toBeNull()
  })

  it('a stale week, a failed later look, a cut list and dropped rows are each said', async () => {
    serve(BODY({ stale_window: true, current_window: { from: '2031-03-17', to: '2031-03-30' }, check: { state: 'failed', reason: 'source' },
      cut: { dividends: true, splits: false }, dividends: [...BODY().dividends, { sym: '', ex_date: '2031-03-11' }] }))
    renderPanel()
    expect((await screen.findByTestId('terminal-dvd-market-stale-window')).textContent)
      .toBe('This is the list for Mon Mar 10 to Sun Mar 23. The list for Mon Mar 17 to Sun Mar 30 is being read and fills in on its own.')
    expect(screen.getByTestId('terminal-dvd-market-check').textContent).toContain('this is the last list read')
    expect(screen.getByTestId('terminal-dvd-market-cut').textContent).toContain('the first 2,000 ex-dividend dates, soonest first')
    expect(screen.getByTestId('terminal-dvd-market-dropped').textContent).toBe('1 row in the answer had no day or no symbol and is not shown.')
  })

  it('what the feed lists for stocks the site does not follow is counted, and the source and read time are said', async () => {
    serve(BODY())
    renderPanel()
    const method = (await screen.findByTestId('terminal-dvd-market-method')).textContent
    expect(method).toContain('Source: Massive reference data, read by the server for Mon Mar 10 to Sun Mar 23.')
    expect(method).toContain('The feed also lists 37 ex-dividend dates and 2 splits for funds, preferred shares and stocks the site does not follow; they are not shown.')
    expect(method).toMatch(/The server read it at \d{1,2}:\d{2} (AM|PM) ET\./)
    expect(method).toContain('The server keeps the list for up to 12 hours.')
  })

  it('every symbol loads through the kit', async () => {
    serve(BODY())
    const { run } = renderPanel(<MarketDividendsPanel />, { code: 'DVD' })
    await screen.findByTestId('terminal-dvd-market-this')
    fireEvent.click(screen.getByTestId('panel-symbol-QQZA'))
    expect(run).toHaveBeenCalledWith('$QQZA')
    fireEvent.click(screen.getByTestId('panel-symbol-QQZE'))
    expect(run).toHaveBeenCalledWith('$QQZE')
  })
})

describe('DVD views', () => {
  it('inside the shell the "Your stocks" chip writes DVD back; the market chip is the pressed one', async () => {
    serve(BODY())
    const { rerun } = renderPanel(<DividendCalendarPanel view="market" />, { code: 'DVD' })
    await screen.findByTestId('terminal-dvd-market-this')
    expect(screen.getByTestId('terminal-dvd-view-market').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-dvd-view-mine'))
    expect(rerun).toHaveBeenCalledWith('DVD')
  })

  it('outside the shell the chips switch views in the panel\'s own state', async () => {
    jsonFetcher.mockImplementation((u) => (u === DVD_MARKET_URL ? Promise.resolve(BODY()) : new Promise(() => {})))
    renderPanel(<DividendCalendarPanel view="market" />)
    await screen.findByTestId('terminal-dvd-market-this')
    fireEvent.click(screen.getByTestId('terminal-dvd-view-mine'))
    expect(screen.queryByTestId('terminal-dvd-market')).toBeNull()
  })

  it('on a panel that follows a stock the word still shows the market, and the first chip names the stock', async () => {
    serve(BODY())
    const { rerun } = renderPanel(<DividendCalendarPanel sym="QQZA" view="market" />, { code: 'DVD' })
    await screen.findByTestId('terminal-dvd-market-this')
    const back = screen.getByTestId('terminal-dvd-view-mine')
    expect(back.textContent).toBe('QQZA')
    expect(back.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(back)
    expect(rerun).toHaveBeenCalledWith('QQZA DVD')
  })
})

describe('DVD MARKET follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['MarketDividendsPanel.jsx', 'marketDividendsModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('DVD MARKET accessibility', () => {
  it('the list, computing and a failed read pass axe (WCAG A and AA)', async () => {
    serve(BODY())
    const ok = renderPanel(<MarketDividendsPanel />, { code: 'DVD' })
    await screen.findByTestId('terminal-dvd-market-splits')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ status: 'computing' })
    const computing = renderPanel()
    await screen.findByTestId('terminal-dvd-market-computing')
    await expectNoAxeViolations(computing.container)
    cleanup()
    serve(httpError(500))
    const failed = renderPanel()
    await screen.findByTestId('terminal-dvd-market-error')
    await expectNoAxeViolations(failed.container)
  })
})
