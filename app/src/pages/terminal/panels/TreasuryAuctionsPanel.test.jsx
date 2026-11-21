// AUCT: Treasury auctions, upcoming and recent results. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan, not switched on, a
//     timeout and an answer that is not the route's shape: none of them is "no auctions";
//   * "computing" is said in words and the panel asks again every 3 seconds on its own;
//   * a refused or unreadable source is an answer in plain words, with no Retry and no table;
//   * an answered, empty pair of lists is an answer, with the source and no figures;
//   * the count line, the two tables (coming up soonest first, results newest first), each day in
//     words, each security with its amount and tags, the result with the kind of rate it is, the
//     bid-to-cover ratio and the three bidder shares; a missing figure is "No figure", never 0;
//   * 12 results, then the rest on request; rows that cannot be placed are counted in a note;
//   * a look for newer records that failed is said above the last good ones, with their date;
//   * the dates and source in words, the door to RATES, no hard-coded color, phone columns, axe.
// Every security, amount and rate is invented.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-18' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import TreasuryAuctionsPanel from './TreasuryAuctionsPanel'
import { AUCT_CODE, AUCT_RESULTS_SHOWN, AUCT_SOURCE, AUCT_URL } from './treasuryAuctionsModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const up = (type, term, date, over = {}) => ({
  security_type: type, security_term: term, auction_date: date, issue_date: '2026-11-30', announced_date: '2026-11-12',
  offering_amount: 58_000_000_000, reopening: false, cusip: '00000AA11', ...over,
})
const split = (i, d, p) => ({
  indirect: { amount: i * 4e8, share: i }, direct: { amount: d * 4e8, share: d }, primary_dealers: { amount: p * 4e8, share: p }, total: 40e9,
})
const res = (type, term, date, over = {}) => ({
  security_type: type, security_term: term, auction_date: date, issue_date: '2026-11-16', maturity_date: '2036-11-15',
  offering_amount: 42_000_000_000, rate: 4.117, rate_kind: 'high_yield', bid_to_cover: 2.58, reopening: false, tips: false,
  floating_rate: false, cash_management: false, cusip: `0000${term.replace(/\W/g, '')}`, bidders: split(70.5, 19.5, 10), ...over,
})
const BODY = (over = {}) => ({
  status: 'ok', as_of: '2026-11-17', upcoming_as_of: '2026-11-17', results_through: '2026-11-17', window_days: 45,
  upcoming: [
    up('Bond', '20-Year', '2026-11-18', { offering_amount: 16_000_000_000, reopening: true }),
    up('Bill', '13-Week', '2026-11-23', { offering_amount: 76_000_000_000, issue_date: '2026-11-27' }),
    up('Bill', '26-Week', '2026-11-23', { offering_amount: null, announced_date: null }),
  ],
  results: [
    res('Bill', '4-Week', '2026-11-17', { rate: 4.25, rate_kind: 'high_rate', bid_to_cover: 2.91, bidders: null, offering_amount: 80_000_000_000 }),
    res('Note', '10-Year', '2026-11-12'),
    res('Note', '10-Year TIPS', '2026-11-12', { rate: 1.842, tips: true, reopening: true, bidders: split(62.4, 28.1, 9.5) }),
    res('Note', '2-Year FRN', '2026-11-10', { rate: 0.16, rate_kind: 'high_discount_margin', floating_rate: true }),
    res('Bond', '30-Year', '2026-11-05', { rate: null, rate_kind: null, bid_to_cover: null, bidders: null }),
  ],
  dropped: { upcoming: 0, results: 0 }, read_at: '2026-11-17T23:20:04+00:00', basis: 'as_published', source: AUCT_SOURCE, check: null, ...over,
})
const many = (n) => Array.from({ length: n }, (_, i) => res('Bill', `${i + 1}-Week`, `2026-11-${String(17 - Math.floor(i / 3)).padStart(2, '0')}`, { rate_kind: 'high_rate' }))

const httpError = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status, ...extra })
const PENDING = Symbol('pending')
function serve(body) {
  jsonFetcher.mockImplementation((u) => {
    if (u !== AUCT_URL) return Promise.reject(httpError(500))
    const hit = typeof body === 'function' ? body() : body
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
function renderPanel({ open = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><TreasuryAuctionsPanel /></TerminalPanelContext.Provider>
            : <TreasuryAuctionsPanel />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { open, setFreshness, container: view.container }
}
const frame = () => screen.getByTestId('terminal-auct')
const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)
const upcomingRows = () => screen.getAllByTestId('terminal-auct-upcoming-row')
const resultRows = () => screen.getAllByTestId('terminal-auct-result-row')
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()
const noTables = () => !screen.queryByTestId('terminal-auct-upcoming') && !screen.queryByTestId('terminal-auct-results')

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('AUCT states', () => {
  it('shows a loading skeleton and asks the one route', () => {
    serve(PENDING)
    renderPanel()
    expect(AUCT_CODE).toBe('AUCT')
    expect(screen.getByTestId('terminal-auct-loading')).toBeTruthy()
    expect(frame().getAttribute('data-state')).toBe('loading')
    expect(noTables()).toBe(true)
    expect([...new Set(jsonFetcher.mock.calls.map(([u]) => u))]).toEqual(['/api/research/treasury-auctions'])
  })

  it('a failed read (500) is an error with Retry, never "no auctions"', async () => {
    serve(httpError(500))
    const { setFreshness } = renderPanel({ code: 'AUCT' })
    const err = await screen.findByTestId('terminal-auct-error')
    expect(frame().getAttribute('data-state')).toBe('error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The Treasury auction list could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no auctions. Retry, or run AUCT again.')
    expect(screen.queryByTestId('terminal-auct-none')).toBeNull()
    expect(noTables()).toBe(true)
    expect(noDated(setFreshness)).toBe(true)
    serve(BODY())
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-auct-results')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and not switched on each say so; only an error can be retried', async () => {
    for (const [hit, kind, words] of [
      [httpError(401), 'error', 'You are signed out, so the Treasury auction list cannot be read. Sign in again.'],
      [httpError(0, { timedOut: true }), 'error', 'The Treasury auction list did not answer within 30 seconds.'],
      [httpError(503), 'error', 'The Treasury auction list could not be read just now.'],
      [httpError(402), 'locked', 'The Treasury auction list needs a paid plan.'],
      [httpError(404), 'locked', 'The Treasury auction list is not switched on for this server yet.'],
    ]) {
      serve(hit)
      renderPanel()
      const box = await screen.findByTestId('terminal-auct-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      expect(noTables(), words).toBe(true)
      cleanup()
    }
  })

  it('an answer that is not the route\'s shape is a failed read with Retry, never an empty list', async () => {
    for (const bad of [{ status: 'failed', reason: 'source', http_status: null }, { status: 'ok' }, { status: 'ok', upcoming: [], results: 'none' }, ['x']]) {
      serve(bad)
      const { setFreshness } = renderPanel()
      const err = await screen.findByTestId('terminal-auct-error')
      expect(err.getAttribute('data-kind')).toBe('error')
      expect(err.textContent).toContain('The Treasury auction list could not be read just now.')
      expect(err.textContent).toContain('That is not the same as no auctions.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      expect(screen.queryByTestId('terminal-auct-none')).toBeNull()
      expect(noDated(setFreshness)).toBe(true)
      cleanup()
    }
  })

  it('"computing" is said in words, and the panel asks again every 3 seconds until it fills in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let body = { status: 'computing', source: AUCT_SOURCE }
    serve(() => body)
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-auct-computing')
    expect(frame().getAttribute('data-state')).toBe('computing')
    expect(box.getAttribute('role')).toBe('status')
    expect(box.textContent).toContain('Loading, the server is preparing this.')
    expect(box.textContent).toContain('This panel asks again every 3 seconds')
    expect(box.textContent).toContain('That is not the same as no auctions.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    const before = jsonFetcher.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    expect(jsonFetcher.mock.calls.length).toBeGreaterThan(before)
    body = BODY()
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    await waitFor(() => expect(screen.getByTestId('terminal-auct-results')).toBeTruthy())
    // once it holds an answer it stops asking every 3 seconds
    const held = jsonFetcher.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
    expect(jsonFetcher.mock.calls.length).toBe(held)
  })

  it('a refused source is an answer in plain words: no Retry, no table, no date', async () => {
    serve({ status: 'unavailable', reason: 'refused', http_status: 403, source: AUCT_SOURCE })
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-auct-unavailable')
    expect(frame().getAttribute('data-state')).toBe('unavailable')
    expect(box.getAttribute('data-kind')).toBe('locked')
    expect(box.textContent).toContain("Treasury auctions are not available right now: the Treasury's data service refused the server's request (it answered 403).")
    expect(box.textContent).toContain('That is not the same as no auctions.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(noTables()).toBe(true)
    expect(noDated(setFreshness)).toBe(true)
  })

  it('an unreadable answer from the source says so, with no table', async () => {
    serve({ status: 'unavailable', reason: 'shape', http_status: 200 })
    renderPanel()
    const box = await screen.findByTestId('terminal-auct-unavailable')
    expect(box.textContent).toContain("the Treasury's data service answered, but not with rows this screen can read.")
    expect(noTables()).toBe(true)
  })

  it('an answered, empty pair of lists is an answer, not a failed read', async () => {
    serve(BODY({ upcoming: [], results: [], as_of: null, upcoming_as_of: null, results_through: null }))
    const { setFreshness } = renderPanel()
    const box = await screen.findByTestId('terminal-auct-none')
    expect(frame().getAttribute('data-state')).toBe('none')
    expect(box.getAttribute('data-kind')).toBe('empty')
    expect(box.textContent).toContain('The Treasury lists no auction from today on. No auction is listed for the last 45 days.')
    expect(box.textContent).toContain('That is an answer, not a failed read.')
    expect(screen.queryByTestId('terminal-auct-error')).toBeNull()
    expect(noTables()).toBe(true)
    expect(screen.getByTestId('terminal-auct-method').textContent).toContain('The answer carries no date of its own. Source: US Treasury Fiscal Data.')
    expect(lastReport(setFreshness)).toBeTruthy()
  })
})

describe('AUCT the answer', () => {
  it('the count line, and the header carries the source and the newest record date', async () => {
    serve(BODY())
    const { setFreshness } = renderPanel()
    expect((await screen.findByTestId('terminal-auct-count')).textContent).toBe(
      '3 auctions are coming up, the next today. 5 auctions in the last 45 days are listed with their results.')
    expect(frame().getAttribute('data-state')).toBe('ok')
    const report = lastReport(setFreshness)
    expect(JSON.stringify(report)).toContain('US Treasury Fiscal Data')
    expect(JSON.stringify(report)).toContain('2026-11-17')
  })

  it('coming up: soonest day first, each day in words, the security with its amount and tags', async () => {
    serve(BODY())
    renderPanel()
    const table = await screen.findByTestId('terminal-auct-upcoming')
    expect(table.getAttribute('aria-label')).toBe('Treasury auctions coming up, soonest day first, 3 auctions')
    expect(table.querySelector('caption').textContent).toBe('Coming up')
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Security', 'Issues', 'Announced'])
    expect([...table.querySelectorAll('tbody th[scope="rowgroup"]')].map((th) => th.textContent)).toEqual(['Wed Nov 18 (today)', 'Mon Nov 23'])
    expect(upcomingRows().map(cells)).toEqual([
      ['20-Year Bond$16.00B offered, reopening', 'Nov 30', 'Nov 12'],
      ['13-Week Bill$76.00B offered', 'Nov 27', 'Nov 12'],
      ['26-Week BillAmount not given', 'Nov 30', 'Not given'],
    ])
    expect(within(screen.getByTestId('terminal-auct-upcoming-day-2026-11-23')).getAllByTestId('terminal-auct-upcoming-row')).toHaveLength(2)
  })

  it('results: newest day first, the result with the kind of rate it is, cover and the three shares', async () => {
    serve(BODY())
    renderPanel()
    const table = await screen.findByTestId('terminal-auct-results')
    expect(table.getAttribute('aria-label')).toBe('Treasury auction results, newest day first, 5 auctions')
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Security', 'Result', 'Cover', 'Indirect', 'Direct', 'Dealers'])
    expect([...table.querySelectorAll('tbody th[scope="rowgroup"]')].map((th) => th.textContent)).toEqual(['Tue Nov 17', 'Thu Nov 12', 'Tue Nov 10', 'Thu Nov 5'])
    const rows = resultRows().map(cells)
    expect(rows[1]).toEqual(['10-Year Note$42.00B offered', '4.117%high yield', '2.58', '70.5%', '19.5%', '10.0%'])
    expect(rows[2]).toEqual(['10-Year TIPS Note$42.00B offered, TIPS, reopening', '1.842%high yield', '2.58', '62.4%', '28.1%', '9.5%'])
    expect(rows[3]).toEqual(['2-Year FRN Note$42.00B offered, floating rate', '0.160%high discount margin', '2.58', '70.5%', '19.5%', '10.0%'])
    expect(resultRows().map((r) => r.getAttribute('data-kind'))).toEqual(['high_rate', 'high_yield', 'high_yield', 'high_discount_margin', 'none'])
  })

  it('a missing result, cover or bidder split is "No figure" in its cell, never 0', async () => {
    serve(BODY())
    renderPanel()
    await screen.findByTestId('terminal-auct-results')
    const rows = resultRows().map(cells)
    expect(rows[0]).toEqual(['4-Week Bill$80.00B offered', '4.250%high rate', '2.91', 'No figure', 'No figure', 'No figure'])
    expect(rows[4]).toEqual(['30-Year Bond$42.00B offered', 'No figure', 'No figure', 'No figure', 'No figure', 'No figure'])
    const text = screen.getByTestId('terminal-auct-results').textContent
    expect(text).not.toMatch(/(^|[^\d.])0(\.0+)?%/)
    expect(text).not.toContain('NaN')
    // an absent figure is muted, a present one is not
    const last = [...resultRows()[4].querySelectorAll('td')]
    expect(last.slice(1).every((td) => /muted/.test(td.className))).toBe(true)
    expect(/muted/.test(resultRows()[1].querySelectorAll('td')[2].className)).toBe(false)
  })

  it('shows 12 results, then the rest on request, and back', async () => {
    serve(BODY({ results: many(15) }))
    renderPanel()
    await screen.findByTestId('terminal-auct-results')
    expect(AUCT_RESULTS_SHOWN).toBe(12)
    expect(resultRows()).toHaveLength(12)
    const more = screen.getByTestId('terminal-auct-more')
    expect(more.textContent).toBe('Show all 15')
    expect(more.getAttribute('aria-pressed')).toBe('false')
    expect(more.parentElement.textContent).toContain('Showing 12 of 15 auctions.')
    fireEvent.click(more)
    expect(resultRows()).toHaveLength(15)
    expect(screen.getByTestId('terminal-auct-more').textContent).toBe('Show 12')
    expect(screen.getByTestId('terminal-auct-more').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-auct-more'))
    expect(resultRows()).toHaveLength(12)
  })

  it('12 results or fewer need no button', async () => {
    serve(BODY({ results: many(12) }))
    renderPanel()
    await screen.findByTestId('terminal-auct-results')
    expect(resultRows()).toHaveLength(12)
    expect(screen.queryByTestId('terminal-auct-more')).toBeNull()
  })

  it('one list empty says so in words and still draws the other', async () => {
    serve(BODY({ upcoming: [] }))
    renderPanel()
    await screen.findByTestId('terminal-auct-results')
    expect(screen.getByTestId('terminal-auct-upcoming-none').textContent).toBe('The Treasury lists no auction from today on. That is its list, not a failed read.')
    expect(screen.queryByTestId('terminal-auct-upcoming')).toBeNull()
    cleanup()
    serve(BODY({ results: [] }))
    renderPanel()
    await screen.findByTestId('terminal-auct-upcoming')
    expect(screen.getByTestId('terminal-auct-results-none').textContent).toBe('No auction is listed for the last 45 days.')
    expect(screen.queryByTestId('terminal-auct-results')).toBeNull()
  })

  it('rows that cannot be placed are counted in a note, never drawn', async () => {
    serve(BODY({ dropped: { upcoming: 2, results: 0 }, results: [res('Note', '10-Year', '2026-11-12'), res('Note', '5-Year', null)] }))
    renderPanel()
    const note = await screen.findByTestId('terminal-auct-dropped')
    expect(note.textContent).toBe("3 rows in the Treasury's answer had no auction day or no security and are not shown.")
    expect(note.getAttribute('role')).toBe('status')
    expect(resultRows()).toHaveLength(1)
    cleanup()
    serve(BODY({ dropped: { upcoming: 0, results: 1 } }))
    renderPanel()
    expect((await screen.findByTestId('terminal-auct-dropped')).textContent).toBe("1 row in the Treasury's answer had no auction day or no security and is not shown.")
    cleanup()
    serve(BODY())
    renderPanel()
    await screen.findByTestId('terminal-auct-results')
    expect(screen.queryByTestId('terminal-auct-dropped')).toBeNull()
  })

  it('a list the server cut is said in words, with the end it was cut from, and what came is still drawn', async () => {
    serve(BODY({ cut: { upcoming: false, results: true } }))
    renderPanel()
    const note = await screen.findByTestId('terminal-auct-cut')
    expect(note.textContent).toBe('The results held more rows than the site reads at once, newest first: the oldest results are not shown.')
    expect(note.getAttribute('role')).toBe('status')
    expect(resultRows()).toHaveLength(5)
    cleanup()
    serve(BODY({ cut: { upcoming: false, results: false } }))
    renderPanel()
    await screen.findByTestId('terminal-auct-results')
    expect(screen.queryByTestId('terminal-auct-cut')).toBeNull()
  })

  it('a look for newer records that failed is said above the last good ones, with their date', async () => {
    serve(BODY({ check: { state: 'failed', reason: 'source', http_status: null, at: '2026-11-18T23:20:00+00:00' } }))
    renderPanel()
    const note = await screen.findByTestId('terminal-auct-check')
    expect(note.textContent).toBe('The last look for newer auction records did not get an answer. These are the last records the site read, through Nov 17, 2026.')
    expect(note.getAttribute('role')).toBe('status')
    expect(note.compareDocumentPosition(screen.getByTestId('terminal-auct-results')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(resultRows()).toHaveLength(5)
    cleanup()
    serve(BODY({ check: { state: 'unavailable', reason: 'refused', http_status: 403 } }))
    renderPanel()
    expect((await screen.findByTestId('terminal-auct-check')).textContent).toContain("The Treasury's data service refused the server's request (it answered 403).")
    cleanup()
    serve(BODY())
    renderPanel()
    await screen.findByTestId('terminal-auct-results')
    expect(screen.queryByTestId('terminal-auct-check')).toBeNull()
  })

  it('the dates, the source and the read time are on screen in words, with what each column means', async () => {
    serve(BODY())
    renderPanel()
    const method = await screen.findByTestId('terminal-auct-method')
    expect(method.textContent).toContain("The list of coming auctions is the Treasury's as of Nov 17, 2026. Results run through Nov 17, 2026. Source: US Treasury Fiscal Data.")
    expect(method.textContent).toMatch(/The site read it at \d{1,2}:\d{2}(:\d{2})? ?(AM|PM)? ?ET\./)
    expect(method.textContent).toContain('the high yield for a note, a bond or TIPS, the high rate for a bill and the high discount margin for a floating rate note')
    expect(method.textContent).toContain('worked out by the server')
    expect(method.textContent).toContain('reads “No figure”, never 0')
    expect(method.textContent).toContain('once each weekday evening')
    expect(method.textContent).not.toMatch(/—/)
  })

  it('the door to Treasury yields opens RATES', async () => {
    serve(BODY())
    const { open } = renderPanel()
    await screen.findByTestId('terminal-auct-results')
    fireEvent.click(within(screen.getByTestId('terminal-auct-links')).getByRole('button', { name: 'Open Treasury yields (RATES)' }))
    expect(open).toHaveBeenCalledWith('RATES')
  })

  it('a later read that fails keeps the last answer and says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let body = BODY()
    serve(() => body)
    renderPanel()
    await screen.findByTestId('terminal-auct-results')
    body = httpError(500)
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 500) })
    const note = await screen.findByTestId('terminal-auct-stale-read')
    expect(note.textContent).toBe('The Treasury auction list could not be read just now. Showing the last read.')
    expect(resultRows()).toHaveLength(5)
  })
})

describe('AUCT the look', () => {
  it('folds the announcement day and the direct and dealer shares on a phone, and nothing else', async () => {
    serve(BODY())
    renderPanel()
    const results = await screen.findByTestId('terminal-auct-results')
    const hidden = (el) => /phoneHide/.test(el.className)
    expect([...results.querySelectorAll('thead th')].map(hidden)).toEqual([false, false, false, false, true, true])
    for (const tr of resultRows()) expect([...tr.querySelectorAll('td')].map(hidden)).toEqual([false, false, false, false, true, true])
    const upcoming = screen.getByTestId('terminal-auct-upcoming')
    expect([...upcoming.querySelectorAll('thead th')].map(hidden)).toEqual([false, false, true])
    for (const tr of upcomingRows()) expect([...tr.querySelectorAll('td')].map(hidden)).toEqual([false, false, true])
    // the long cell may wrap, so the table never pushes the panel sideways
    expect(/wrapCell/.test(resultRows()[0].querySelector('td').className)).toBe(true)
  })

  it('has no hard-coded color, no price color, no @media of its own and no fold step', () => {
    const src = fs.readFileSync(path.join(HERE, 'TreasuryAuctionsPanel.jsx'), 'utf8')
    const model = fs.readFileSync(path.join(HERE, 'treasuryAuctionsModel.js'), 'utf8')
    expect(colourLiteralsIn(src, 'TreasuryAuctionsPanel.jsx')).toEqual([])
    expect(colourLiteralsIn(model, 'treasuryAuctionsModel.js')).toEqual([])
    expect(src).not.toMatch(/styles\.(pos|neg|up|down|gain|loss)\b/)
    expect(src).not.toMatch(/data-fold/)
    expect(src).not.toMatch(/style=\{\{/)
    expect(src).toContain("from './marketPanels.module.css'")
    expect(`${src}${model}`).not.toMatch(/—/)
  })

  it('every state passes axe', async () => {
    serve(BODY())
    const ok = renderPanel()
    await screen.findByTestId('terminal-auct-results')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ status: 'unavailable', reason: 'refused', http_status: 403 })
    const refused = renderPanel()
    await screen.findByTestId('terminal-auct-unavailable')
    await expectNoAxeViolations(refused.container)
    cleanup()
    serve(BODY({ upcoming: [], results: [] }))
    const none = renderPanel()
    await screen.findByTestId('terminal-auct-none')
    await expectNoAxeViolations(none.container)
    cleanup()
    serve(httpError(500))
    const failed = renderPanel()
    await screen.findByTestId('terminal-auct-error')
    await expectNoAxeViolations(failed.container)
    cleanup()
    serve({ status: 'computing' })
    const computing = renderPanel()
    await screen.findByTestId('terminal-auct-computing')
    await expectNoAxeViolations(computing.container)
  })
})
