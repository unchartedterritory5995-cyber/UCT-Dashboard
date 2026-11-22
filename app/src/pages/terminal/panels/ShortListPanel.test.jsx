// SHRTS: the newest FINRA short interest report across the stocks UCT follows, ranked. Rails:
//   * loading, a failed read (error with Retry), signed out, not on a paid plan, a switched-off
//     route and an answer that is not the route's shape: none of them is an empty list;
//   * "computing" is a working state and the panel fills in on its own;
//   * a refused data plan (and a report the vendor sent that cannot be read) is said in plain
//     words, with no Retry and no as-of;
//   * the report's date and age above the rows, how many stocks are in it, how many the rank
//     covers, how many are on screen, and that the server cut the list;
//   * the rows: days to cover, short interest, the change in percent and shares, percent of
//     float; a missing number is words, never 0; no color for a change;
//   * the rank chips ask for their own route and write themselves into the command; a typed word
//     seeds them; on a phone the ranked column is the one that stays;
//   * a refused check and a report still arriving are said above a list that is still shown;
//   * where the numbers come from is always on screen; tickers load the linked panels; axe.
// The fixtures are the route's real shape (api/services/short_data.py), with made-up tickers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-18' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import ShortListPanel, { PAGE_ROWS, SHORT_LIST_CODE, emptyRankWords, rankSentence, reportSentence, shortListUrl } from './ShortListPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'FINRA, through Massive'
const url = (rank) => `/api/research/short-interest-list?rank=${rank}`
const row = (sym, over = {}) => ({
  sym, short_interest: 3000000, avg_daily_volume: 500000, days_to_cover: 6, prev_short_interest: 2000000, change_shares: 1000000, change_pct: 50,
  float_shares: 10000000, pct_float: 30, ...over,
})
const ROWS = [
  row('ZZA', { days_to_cover: 12.4 }),
  row('ZZB', { short_interest: 600000, days_to_cover: 9.1, prev_short_interest: 1000000, change_shares: -400000, change_pct: -40, pct_float: null, float_shares: null }),
  row('ZZC', { days_to_cover: 7, prev_short_interest: null, change_shares: null, change_pct: null, avg_daily_volume: null }),
  row('ZZD', { days_to_cover: 6.5, prev_short_interest: 3000000, change_shares: 0, change_pct: 0 }),
  row('ZZE', { days_to_cover: 5, prev_short_interest: 0, change_shares: 3000000, change_pct: null }),
]
const answer = (over = {}) => ({
  status: 'ok', rank: 'dtc', settlement_date: '2026-10-30', previous_settlement_date: '2026-10-15', newer_report_landing: null,
  published: null, publication_estimate: '2026-11-10', published_basis: 'x', read_at: '2026-11-18T15:02:11+00:00',
  count: 3412, universe: 3639, ranked: 3100, limit: 100, cut: true, floor_shares: null, rows: ROWS,
  float: { state: 'ok', with_float: 3301, withheld: 4, source: 'x' }, source: SOURCE, check: null, ...over,
})
const many = (n) => Array.from({ length: n }, (_, i) => row(`Q${String(i).padStart(3, '0')}`.replace(/\d/g, (d) => 'ABCDEFGHIJ'[d]), { days_to_cover: 90 - i }))

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves each route its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((u) => {
    const hit = routes[u]
    if (hit === undefined) return Promise.reject(fail(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <ShortListPanel {...props} />
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, rerun, publishRows, setFreshness, container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const rows = () => screen.getAllByTestId('terminal-shorts-row')
const syms = () => rows().map((r) => r.getAttribute('data-sym'))
const cells = (sym) => [...rows().find((r) => r.getAttribute('data-sym') === sym).querySelectorAll('td')]
/** A cell's lines, as the <br /> splits them. */
const lines = (td) => td.innerHTML.split(/<br\s*\/?>/).map((h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent })
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const root = () => screen.getByTestId('terminal-shorts')

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('SHRTS states', () => {
  it('shows a loading skeleton under the rank chips and asks the one route', () => {
    serve({ [url('dtc')]: PENDING })
    renderPanel()
    expect(SHORT_LIST_CODE).toBe('SHRTS')
    expect(shortListUrl('dtc')).toBe(url('dtc'))
    expect(screen.getByTestId('terminal-shorts-loading')).toBeTruthy()
    expect(root().getAttribute('data-state')).toBe('loading')
    expect(screen.getByRole('toolbar', { name: 'Short interest list controls' })).toBeTruthy()
    expect(asked()).toEqual([url('dtc')])
  })

  it('a failed read (500) is an error with Retry, never an empty list', async () => {
    serve({})
    const { setFreshness, publishRows } = renderPanel({}, { code: 'SHRTS' })
    const err = await screen.findByTestId('terminal-shorts-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The short interest list could not be read just now.')
    expect(err.textContent).toContain('That is not the same as an empty list. Retry, or run SHRTS again.')
    expect(screen.queryByTestId('terminal-shorts-table')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    expect(publishRows.mock.calls.every(([r]) => r.length === 0)).toBe(true)
    serve({ [url('dtc')]: answer() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-shorts-table')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so the short interest list cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'The short interest list did not answer within 30 seconds.'],
      [fail(402), 'locked', 'The short interest list needs a paid plan.'],
      [fail(404), 'locked', 'The short interest list is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve({ [url('dtc')]: err })
      renderPanel()
      const state = await screen.findByTestId('terminal-shorts-error')
      expect(state.getAttribute('data-kind'), words).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
    }
  })

  it('an answer that is not the route\'s shape, and a failed build, are errors with Retry', async () => {
    for (const body of [{ detail: 'something else' }, { status: 'failed', reason: 'universe' }, answer({ rows: null })]) {
      cleanup()
      serve({ [url('dtc')]: body })
      renderPanel()
      const err = await screen.findByTestId('terminal-shorts-error')
      expect(err.getAttribute('data-kind')).toBe('error')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      expect(screen.queryByTestId('terminal-shorts-none')).toBeNull()
    }
  })

  it('"computing" says the server is still working, and the panel fills in on its own', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => { n += 1; return n === 1 ? { status: 'computing' } : answer() })
    const { setFreshness } = renderPanel()
    const working = await screen.findByTestId('terminal-shorts-computing')
    expect(working.getAttribute('role')).toBe('status')
    expect(working.textContent).toContain('Loading, the server is preparing this.')
    expect(working.textContent).toContain('This panel asks again every 3 seconds and fills in on its own. That is not the same as an empty list.')
    expect(root().getAttribute('data-state')).toBe('computing')
    expect(noDated(setFreshness)).toBe(true)
    // no click: the panel asks again by itself
    await screen.findByTestId('terminal-shorts-table', {}, { timeout: 6000 })
    expect(n).toBeGreaterThanOrEqual(2)
  }, 15_000)

  it('a refused data plan is said in plain words: not an error, no Retry, no as-of, no rows', async () => {
    serve({ [url('dtc')]: { status: 'unavailable', reason: 'refused', http_status: 403, source: SOURCE } })
    const { setFreshness, publishRows } = renderPanel()
    const state = await screen.findByTestId('terminal-shorts-unavailable')
    expect(state.getAttribute('data-kind')).toBe('locked')
    expect(state.getAttribute('role')).toBe('status')
    expect(state.textContent).toContain('Short interest is not available on the data plan right now (the data vendor answered 403).')
    expect(state.textContent).toContain('The site reads FINRA short interest through its stock-data vendor, Massive, and the vendor did not allow it.')
    expect(state.textContent).toContain('That is not the same as an empty list. The server asks again by itself; nothing here needs a retry.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByTestId('terminal-shorts-table')).toBeNull()
    expect(root().getAttribute('data-state')).toBe('unavailable')
    expect(noDated(setFreshness)).toBe(true)
    expect(publishRows.mock.calls.every(([r]) => r.length === 0)).toBe(true)
  })

  it('no key on the server, and a report that cannot be read as a market, each say which', async () => {
    for (const [body, words, blamesPlan] of [
      [{ status: 'unavailable', reason: 'not_configured', http_status: null }, 'Short interest is not available on this server: it has no key for the data vendor.', true],
      [{ status: 'unavailable', reason: 'thin', http_status: 200 }, 'Short interest is not available right now: the data vendor answered, but not with a report this screen can read.', false],
      [{ status: 'unavailable', reason: 'shape', http_status: 200 }, 'Short interest is not available right now: the data vendor answered, but not with a report this screen can read.', false],
    ]) {
      cleanup()
      serve({ [url('dtc')]: body })
      renderPanel()
      const state = await screen.findByTestId('terminal-shorts-unavailable')
      expect(state.textContent).toContain(words)
      expect(state.textContent.includes('the vendor did not allow it'), words).toBe(blamesPlan)
    }
  })
})

describe('SHRTS the list', () => {
  it('says the report, its age, how many stocks it holds, how many are ranked and that the list was cut', async () => {
    serve({ [url('dtc')]: answer() })
    const { setFreshness, publishRows } = renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    expect(root().getAttribute('data-state')).toBe('ok')
    expect(root().getAttribute('data-rank')).toBe('dtc')
    expect(screen.getByTestId('terminal-shorts-report').textContent).toBe(
      'FINRA short interest for the Oct 30, 2026 settlement date, 19 days ago. 3,412 of the 3,639 stocks UCT follows are in it. '
      + 'Each is set beside its Oct 15, 2026 report.',
    )
    expect(screen.getByTestId('terminal-shorts-ranked').textContent).toBe(
      '3,100 stocks ranked, most days to cover first. The server sent the first 5; showing all of those.',
    )
    expect(syms()).toEqual(['ZZA', 'ZZB', 'ZZC', 'ZZD', 'ZZE'])
    expect(screen.getByRole('table', { name: 'Short interest for the Oct 30, 2026 settlement date, most days to cover first, 5 of 3100' })).toBeTruthy()
    expect([...screen.getByTestId('terminal-shorts-table').querySelectorAll('th')].map((th) => th.textContent))
      .toEqual(['Symbol', 'Days to cover', 'Short interest', 'Change', '% of float', 'Avg daily volume'])
    // the header names the source and the settlement date, never the time of the read
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: SOURCE, age: { asOfDate: '2026-10-30' } })))
    expect(publishRows).toHaveBeenLastCalledWith(['$ZZA', '$ZZB', '$ZZC', '$ZZD', '$ZZE'])
    expect(document.body.textContent).not.toMatch(/[—–]/)
    expect(asked()).toEqual([url('dtc')])
  })

  it('a row: rank number and symbol, days to cover, shares, the change in percent and shares, percent of float, volume', async () => {
    serve({ [url('dtc')]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    const [symCell, dtc, short, change, flt, adv] = cells('ZZA')
    expect(symCell.textContent).toBe('1ZZA')
    expect(dtc.textContent).toBe('12.4')
    expect(short.textContent).toBe('3.0M')
    expect(lines(change)).toEqual(['+50.0%', '+1.0M'])
    expect(flt.textContent).toBe('30.0%')
    expect(adv.textContent).toBe('500K')
    // a fall carries its sign; no color is used for either direction
    expect(lines(cells('ZZB')[3])).toEqual(['-40.0%', '-400K'])
    expect(screen.getByTestId('terminal-shorts-table').querySelector('[class*="up"], [class*="down"]')).toBeNull()
  })

  it('a missing number is words, never 0: no earlier report, no percent from a zero base, no float, no volume', async () => {
    serve({ [url('dtc')]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    expect(cells('ZZB')[4].textContent).toBe('No float')
    expect(cells('ZZC')[3].textContent).toBe('No earlier report')
    expect(cells('ZZC')[5].textContent).toBe('not given')
    expect(lines(cells('ZZD')[3])).toEqual(['Unchanged', '0'])
    expect(lines(cells('ZZE')[3])).toEqual(['No percent', '+3.0M'])
    // nothing that was missing became a zero percent
    for (const sym of ['ZZB', 'ZZC', 'ZZE']) expect(cells(sym).map((td) => td.textContent).join(' '), sym).not.toMatch(/(^|[^\d.])0(\.0)?%/)
  })

  it('draws 25 rows at first and 25 more each time, and counts what the server sent', async () => {
    serve({ [url('dtc')]: answer({ rows: many(60), ranked: 3100, cut: true }) })
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    expect(PAGE_ROWS).toBe(25)
    expect(rows()).toHaveLength(25)
    expect(screen.getByTestId('terminal-shorts-ranked').textContent)
      .toBe('3,100 stocks ranked, most days to cover first. The server sent the first 60; showing the first 25 of those.')
    expect(publishRows.mock.lastCall[0]).toHaveLength(25)
    fireEvent.click(screen.getByTestId('terminal-shorts-more'))
    expect(rows()).toHaveLength(50)
    expect(screen.getByTestId('terminal-shorts-more').textContent).toBe('Show 10 more')
    fireEvent.click(screen.getByTestId('terminal-shorts-more'))
    expect(rows()).toHaveLength(60)
    expect(screen.queryByTestId('terminal-shorts-more')).toBeNull()
    expect(screen.getByTestId('terminal-shorts-ranked').textContent).toContain('The server sent the first 60; showing all of those.')
    expect(rows()[59].querySelector('td').textContent.startsWith('60')).toBe(true)
  })

  it('a list the server did not cut does not say it did, and rows it could not read are counted', async () => {
    serve({ [url('dtc')]: answer({ cut: false, ranked: 5, rows: [...ROWS, { sym: '', short_interest: 5 }, row('ZZX', { short_interest: null })] }) })
    renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    expect(screen.getByTestId('terminal-shorts-ranked').textContent).toBe('5 stocks ranked, most days to cover first. Showing all 5.')
    expect(screen.getByTestId('terminal-shorts-unread').textContent).toBe('2 rows came without a symbol or a short interest and are not listed.')
  })

  it('the sentences on their own', () => {
    const base = { settlementDate: '2026-10-30', previousDate: null, count: null, universe: null, rank: 'up', ranked: 1, rows: [{}], cut: false, floorShares: 500000 }
    expect(reportSentence(base, '2026-10-31')).toBe('FINRA short interest for the Oct 30, 2026 settlement date, 1 day ago. There is no earlier report to set it beside.')
    expect(reportSentence(base, 'x')).toBe('FINRA short interest for the Oct 30, 2026 settlement date. There is no earlier report to set it beside.')
    expect(rankSentence(base, 1)).toBe(
      '1 stock ranked, biggest percent increase in short interest first. Showing it. '
      + 'Only stocks whose previous report was at least 500,000 shares are ranked, so a tiny position cannot top the list.',
    )
    expect(rankSentence({ ...base, rank: 'dtc', ranked: 60, rows: Array(60).fill({}), floorShares: null }, 25))
      .toBe('60 stocks ranked, most days to cover first. Showing the first 25.')
    expect(emptyRankWords({ rank: 'float' })).toBe('No stock in the report has a float on file, so none can be ranked by percent of float.')
    expect(emptyRankWords({ rank: 'dtc' })).toBe('No stock in the report came with days to cover.')
    expect(emptyRankWords({ rank: 'up', previousDate: null })).toBe('There is no earlier report to measure a change from.')
    expect(emptyRankWords({ rank: 'down', previousDate: '2026-10-15', floorShares: 500000 })).toBe('No stock with a previous report of at least 500,000 shares fell in this report.')
  })
})

describe('SHRTS ranks', () => {
  it('a chip asks for its own rank, shows its own rows, and says the floor under a percent change', async () => {
    serve({
      [url('dtc')]: answer(),
      [url('up')]: answer({ rank: 'up', ranked: 2, cut: false, floor_shares: 500000, rows: [ROWS[0], row('ZZU', { change_pct: 20, change_shares: 500000 })] }),
    })
    const { rerun, publishRows } = renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    expect(screen.getByTestId('terminal-shorts-rank-dtc').getAttribute('aria-pressed')).toBe('true')
    expect(['dtc', 'up', 'down', 'float'].map((k) => screen.getByTestId(`terminal-shorts-rank-${k}`).textContent))
      .toEqual(['Days to cover', 'Biggest increase', 'Biggest decrease', 'Percent of float'])
    fireEvent.click(screen.getByTestId('terminal-shorts-rank-up'))
    // the other rank's rows are never drawn under this rank's name while its read is on the way
    expect(root().getAttribute('data-rank')).toBe('up')
    await waitFor(() => expect(syms()).toEqual(['ZZA', 'ZZU']))
    expect(screen.getByTestId('terminal-shorts-rank-up').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-shorts-ranked').textContent).toBe(
      '2 stocks ranked, biggest percent increase in short interest first. Showing all 2. '
      + 'Only stocks whose previous report was at least 500,000 shares are ranked, so a tiny position cannot top the list.',
    )
    expect(publishRows).toHaveBeenLastCalledWith(['$ZZA', '$ZZU'])
    expect(asked()).toEqual([url('dtc'), url('up')])
    // outside the shell nothing is re-run
    expect(rerun).not.toHaveBeenCalled()
  })

  it('in the shell a chip writes its word into the command, and the default is the bare command', async () => {
    serve({ [url('dtc')]: answer(), [url('float')]: answer({ rank: 'float' }), [url('down')]: answer({ rank: 'down' }) })
    const { rerun } = renderPanel({}, { code: 'SHRTS' })
    await screen.findByTestId('terminal-shorts-table')
    fireEvent.click(screen.getByTestId('terminal-shorts-rank-float'))
    expect(rerun).toHaveBeenLastCalledWith('SHRTS FLOAT')
    fireEvent.click(screen.getByTestId('terminal-shorts-rank-down'))
    expect(rerun).toHaveBeenLastCalledWith('SHRTS DOWN')
    fireEvent.click(screen.getByTestId('terminal-shorts-rank-dtc'))
    expect(rerun).toHaveBeenLastCalledWith('SHRTS')
  })

  it('a chip keeps working when the registry does not take its word (the choice stays in the panel)', async () => {
    serve({ [url('dtc')]: answer(), [url('up')]: answer({ rank: 'up' }) })
    // TOPF is a registered code that does not take UP, so nothing may be written back
    const { rerun } = renderPanel({}, { code: 'TOPF' })
    await screen.findByTestId('terminal-shorts-table')
    fireEvent.click(screen.getByTestId('terminal-shorts-rank-up'))
    expect(rerun).not.toHaveBeenCalled()
    await waitFor(() => expect(root().getAttribute('data-rank')).toBe('up'))
    expect(asked()).toEqual([url('dtc'), url('up')])
  })

  it('a typed word or a key seeds the rank; an unknown one is the default', async () => {
    serve({ [url('float')]: answer({ rank: 'float' }), [url('down')]: answer({ rank: 'down' }), [url('dtc')]: answer() })
    renderPanel({ rank: 'FLOAT' })
    await screen.findByTestId('terminal-shorts-table')
    expect(root().getAttribute('data-rank')).toBe('float')
    cleanup()
    renderPanel({ rank: 'down' })
    await screen.findByTestId('terminal-shorts-table')
    expect(root().getAttribute('data-rank')).toBe('down')
    cleanup()
    renderPanel({ rank: 'banana' })
    await screen.findByTestId('terminal-shorts-table')
    expect(root().getAttribute('data-rank')).toBe('dtc')
    expect(asked()).toEqual([url('float'), url('down'), url('dtc')])
  })

  it('on a phone the ranked column stays: percent of float folds away unless it is the rank', async () => {
    serve({ [url('dtc')]: answer(), [url('float')]: answer({ rank: 'float' }) })
    renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    const folded = () => [...screen.getByTestId('terminal-shorts-table').querySelectorAll('th')].filter((th) => /phoneHide/.test(th.className)).map((th) => th.textContent)
    expect(folded()).toEqual(['% of float', 'Avg daily volume'])
    expect(/phoneHide/.test(cells('ZZA')[4].className)).toBe(true)
    expect(/phoneHide/.test(cells('ZZA')[1].className)).toBe(false)
    fireEvent.click(screen.getByTestId('terminal-shorts-rank-float'))
    await waitFor(() => expect(root().getAttribute('data-rank')).toBe('float'))
    await screen.findByTestId('terminal-shorts-table')
    expect(folded()).toEqual(['Days to cover', 'Avg daily volume'])
    expect(/phoneHide/.test(cells('ZZA')[1].className)).toBe(true)
    expect(/phoneHide/.test(cells('ZZA')[4].className)).toBe(false)
  })

  it('a rank with no stock says why, is not an error, and offers the default rank', async () => {
    serve({ [url('float')]: answer({ rank: 'float', ranked: 0, cut: false, rows: [], float: { state: 'missing', with_float: 0, withheld: 0 } }), [url('dtc')]: answer() })
    renderPanel({ rank: 'float' })
    const none = await screen.findByTestId('terminal-shorts-none')
    expect(none.getAttribute('data-kind')).toBe('empty')
    expect(none.textContent).toContain('No stock in the report has a float on file, so none can be ranked by percent of float.')
    expect(none.textContent).toContain('That is what the report holds, not a failed read.')
    expect(screen.getByTestId('terminal-shorts-report').textContent).toContain('Oct 30, 2026 settlement date')
    expect(screen.getByTestId('terminal-shorts-method').textContent).toContain('The screener export could not be read, so no stock has a percent of float right now.')
    fireEvent.click(screen.getByRole('button', { name: 'Rank by days to cover' }))
    await waitFor(() => expect(syms()).toEqual(['ZZA', 'ZZB', 'ZZC', 'ZZD', 'ZZE']))
  })
})

describe('SHRTS says what it is showing', () => {
  it('a refused check and a report still arriving are said above a list that is still shown', async () => {
    serve({ [url('dtc')]: answer({ check: { state: 'unavailable', reason: 'refused', http_status: 403, at: '2026-11-18T15:00:00+00:00' }, newer_report_landing: '2026-11-13' }) })
    renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    expect(screen.getByTestId('terminal-shorts-check').textContent).toBe(
      'A newer report is not available on the data plan right now (the data vendor answered 403). '
      + 'This is the last list the site read, for the Oct 30, 2026 settlement date.',
    )
    expect(screen.getByTestId('terminal-shorts-landing').textContent).toContain('A newer report, for the Nov 13, 2026 settlement date, is still arriving at the data vendor.')
    expect(syms()).toHaveLength(5)
    cleanup()
    serve({ [url('dtc')]: answer({ check: { state: 'failed', reason: 'vendor', http_status: 502 } }) })
    renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    expect(screen.getByTestId('terminal-shorts-check').textContent).toContain('The last look for a newer report did not get an answer.')
    expect(screen.queryByTestId('terminal-shorts-landing')).toBeNull()
  })

  it('the source, the cadence, FINRA\'s caution and how percent of float is worked out are always on screen', async () => {
    serve({ [url('dtc')]: answer({ float: { state: 'stale', with_float: 3301, withheld: 4 } }) })
    renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    const method = screen.getByTestId('terminal-shorts-method').textContent
    expect(method).toContain('Source: FINRA, through Massive.')
    expect(method).toContain('what brokers report to FINRA twice a month')
    expect(method).toContain('about two weeks old the day it comes out')
    expect(method).toContain('Daily short volume is not short interest (FINRA\'s own caution): it counts short sales in one day\'s off-exchange trades only')
    expect(method).toContain('Percent of float divides FINRA\'s short interest by today\'s float from the nightly screener export')
    expect(method).toContain('above 150% it is not shown.')
    expect(method).toContain('The screener export is several days old.')
    expect(method).toContain('FINRA\'s schedule put this report\'s publication on about Nov 10, 2026; the data vendor does not give the day.')
    expect(method).toMatch(/The site read this report from the data vendor on Nov 18, 2026 at 10:02\sAM ET\./)
  })

  it('a symbol loads into the linked panels', async () => {
    serve({ [url('dtc')]: answer() })
    const { run } = renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    fireEvent.click(screen.getByTestId('panel-symbol-ZZB'))
    expect(run).toHaveBeenCalledWith('$ZZB')
  })
})

describe('SHRTS follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['ShortListPanel.jsx', 'shortListModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('SHRTS accessibility', () => {
  it('the list, an empty rank and the refused plan pass axe (WCAG A and AA)', async () => {
    serve({ [url('dtc')]: answer({ check: { state: 'unavailable', reason: 'refused', http_status: 403 }, newer_report_landing: '2026-11-13' }) })
    renderPanel()
    await screen.findByTestId('terminal-shorts-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [url('float')]: answer({ rank: 'float', ranked: 0, cut: false, rows: [] }) })
    renderPanel({ rank: 'float' })
    await screen.findByTestId('terminal-shorts-none')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [url('dtc')]: { status: 'unavailable', reason: 'refused', http_status: 403 } })
    renderPanel()
    await screen.findByTestId('terminal-shorts-unavailable')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
