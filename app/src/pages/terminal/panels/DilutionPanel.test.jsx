// DILU: the dilution watch, one company's share-issuance filings from the SEC filing index. Rails:
//   * no ticker, loading, a failed read (error with Retry), signed out, not on a paid plan, a
//     switched-off route and an answer that is not the route's shape: none is "no filings";
//   * "computing" is a working state and the panel fills in on its own;
//   * the SEC refusing the server, the SEC's rate limit and a timeout each say so in plain words;
//     only the timeout can be retried;
//   * a symbol the SEC lists no filer for is a calm answer, not an error;
//   * the summary sentence, the facts, the shelf list and the timeline (day, form as the link to
//     sec.gov in a new tab, what it is, and what it was filed under);
//   * employee plans and material agreements are listed apart, on request;
//   * a long timeline shows 20 rows and the rest on request; a read that does not reach back the
//     full three years says so and draws no count it cannot stand behind;
//   * the source, the newest filing date, when the site read it and WHAT THE PANEL DOES NOT KNOW
//     are always on screen with the answer; the header gets the newest filing date;
//   * a new ticker is a new read; no hard-coded color and no green or red; axe.
// The fixtures are the route's real shape (api/services/dilution_watch.py), with made-up filings.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-18' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import DilutionPanel, { DILUTION_CODE, ROWS_SHOWN, dilutionUrl, readAtWords, shelfWords, dilutionRead } from './DilutionPanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'SEC EDGAR filings'
const URL = '/api/research/dilution-watch/ZZA'
/** A date is drawn with spaces that never break a line. */
const nb = (s) => s.replace(/ /g, String.fromCharCode(0x00a0)).replace(/-/g, String.fromCharCode(0x2011))
const SHELF_FILE = '333-270001'
const UNDER = { form: 'S-3', filed: '2025-03-04', shelf: true }
const pad = (n) => String(n).padStart(6, '0')
const sec = (n) => `https://www.sec.gov/Archives/edgar/data/1234567/000123456726${pad(n)}/0001234567-26-${pad(n)}-index.htm`
let seq = 0
const row = (date, form, kind, what, over = {}) => {
  seq += 1
  return { date, form, kind, what, accession: `0001234567-26-${pad(seq)}`, url: sec(seq), file_number: SHELF_FILE, items: [], under: null, ...over }
}
const SHELF = {
  form: 'S-3', what: 'Shelf registration', file_number: SHELF_FILE, filed: '2025-03-04', accession: '0001234567-26-000900', url: sec(900),
  automatic: false, effective: '2025-03-12', effective_basis: 'notice', expires_estimate: '2028-03-12', state: 'live',
  withdrawal_requested: null, amendments: 1, offerings: 5, latest_offering: '2026-10-02',
}
const rows = () => [
  row('2026-10-02', '424B5', 'offering', 'Prospectus supplement', { under: UNDER, url: sec(1) }),
  row('2026-10-01', 'FWP', 'fwp', 'Free writing prospectus (offering material)', { under: UNDER }),
  row('2026-09-30', '8-K', 'unregistered', 'Unregistered sale of equity securities (8-K item 3.02)', { file_number: '001-30001', items: ['1.01', '3.02', '9.01'] }),
  row('2026-08-01', '8-K', 'agreement', 'Material agreement (8-K item 1.01)', { file_number: '001-30001', items: ['1.01', '9.01'] }),
  row('2025-03-12', 'EFFECT', 'effect', 'SEC notice that a registration took effect', { under: UNDER }),
  row('2025-03-10', 'S-3/A', 'shelf_amendment', 'Shelf registration, amended', { under: UNDER }),
  row('2025-03-04', 'S-3', 'shelf', 'Shelf registration'),
  row('2024-02-01', 'S-8', 'plan', 'Employee plan registration', { file_number: '333-260009' }),
]
const answer = (over = {}) => ({
  status: 'ok', sym: 'ZZA', cik: '0001234567', company: 'Acme Example Corp', entity_type: 'operating', fund_like: false,
  window: { years: 3, from: '2023-11-18', to: '2026-11-18', recent_months: 12, recent_from: '2025-11-18' },
  coverage: { complete: true, from: '2023-11-18', requests: 1, pages_unread: 0 },
  newest_filing: '2026-11-05',
  summary: {
    live_shelves: 1, newest_live_shelf: SHELF, pending_shelves: 0, newest_pending_shelf: null,
    offerings: { m12: 4, y3: 6, latest: '2026-10-02' }, unregistered: { m12: 1, y3: 1, latest: '2026-09-30' },
    registrations: { m12: 0, y3: 0, latest: null },
  },
  shelves: [SHELF], shelf_life_years: 3, rows: rows(), rows_total: 8, cut: false,
  counts: {}, read_at: '2026-11-18T15:02:11+00:00', source: SOURCE,
  ...over,
})
const ZEROS = { m12: 0, y3: 0, latest: null }
const nothing = (over = {}) => answer({
  summary: { live_shelves: 0, newest_live_shelf: null, pending_shelves: 0, newest_pending_shelf: null, offerings: ZEROS, unregistered: ZEROS, registrations: ZEROS },
  shelves: [], rows: [], rows_total: 0, ...over,
})
const many = (n) => Array.from({ length: n }, (_, i) => row(`2026-${String(10 - Math.floor(i / 3)).padStart(2, '0')}-${String(28 - (i % 3)).padStart(2, '0')}`,
  '424B2', 'offering', 'Prospectus supplement', { under: UNDER }))

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
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([url]) => url))]

function renderPanel(props = { sym: 'zza' }, { open = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const tree = (p) => (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><DilutionPanel {...p} /></TerminalPanelContext.Provider>
            : <DilutionPanel {...p} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  const view = render(tree(props))
  return { open, setFreshness, rerender: (p) => view.rerender(tree(p)), container: view.container }
}
const HERE = path.dirname(fileURLToPath(import.meta.url))
const tableRows = () => screen.getAllByTestId('terminal-dilution-row')
const cells = (tr) => [...tr.querySelectorAll('td')]
/** A cell's lines, as the <br /> splits them. */
const lines = (td) => td.innerHTML.split(/<br\s*\/?>/).map((h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent })
const noDated = (setFreshness) => setFreshness.mock.calls.every(([report]) => report == null)

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('DILU states', () => {
  it('with no ticker it asks for one and reads nothing', () => {
    serve({})
    renderPanel({ sym: '' }, { code: 'DILU' })
    expect(DILUTION_CODE).toBe('DILU')
    expect(screen.getByText('DILU needs a ticker.')).toBeTruthy()
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('shows a loading skeleton and asks the one route, with the ticker in capitals', () => {
    serve({ [URL]: PENDING })
    renderPanel()
    expect(dilutionUrl('ZZA')).toBe(URL)
    expect(screen.getByTestId('terminal-dilution-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-dilution')).toBeNull()
    expect(asked()).toEqual([URL])
  })

  it('a failed read (500) is an error with Retry, never "no filings"', async () => {
    serve({})
    const { setFreshness } = renderPanel({ sym: 'ZZA' }, { code: 'DILU' })
    const err = await screen.findByTestId('terminal-dilution-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('SEC filings could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no filings. Retry, or run ZZA DILU again.')
    expect(screen.queryByTestId('terminal-dilution-table')).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    serve({ [URL]: answer() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-dilution-table')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and a switched-off route each say so; only an error can be retried', async () => {
    for (const [err, kind, words] of [
      [fail(401), 'error', 'You are signed out, so SEC filings cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'SEC filings did not answer within 30 seconds.'],
      [fail(402), 'locked', 'SEC filings needs a paid plan.'],
      [fail(404), 'locked', 'SEC filings is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve({ [URL]: err })
      renderPanel()
      const state = await screen.findByTestId('terminal-dilution-error')
      expect(state.getAttribute('data-kind'), words).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
    }
  })

  it('an answer that is not the route\'s shape, and a failed build, are errors with Retry', async () => {
    for (const body of [{ detail: 'something else' }, { status: 'failed', sym: 'ZZA', reason: 'error' }, { status: 'failed', sym: 'ZZA', reason: 'source', http_status: 503 }]) {
      cleanup()
      serve({ [URL]: body })
      const { setFreshness } = renderPanel({ sym: 'ZZA' }, { code: 'DILU' })
      const err = await screen.findByTestId('terminal-dilution-failed')
      expect(err.getAttribute('data-kind')).toBe('error')
      expect(err.textContent).toContain('SEC filings for ZZA could not be read just now.')
      expect(err.textContent).toContain('That is not the same as no filings. Retry, or run ZZA DILU again.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
      expect(screen.queryByTestId('terminal-dilution-table')).toBeNull()
      expect(noDated(setFreshness)).toBe(true)
    }
  })

  it('"computing" says the server is still working, and the panel fills in on its own', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => { n += 1; return n === 1 ? { status: 'computing', sym: 'ZZA' } : answer() })
    const { setFreshness } = renderPanel()
    const working = await screen.findByTestId('terminal-dilution-computing')
    expect(working.getAttribute('role')).toBe('status')
    expect(working.textContent).toContain('Loading, the server is preparing this.')
    expect(working.textContent).toContain('This panel asks again every 3 seconds and fills in on its own. That is not the same as no filings.')
    expect(screen.getByTestId('terminal-dilution').getAttribute('data-state')).toBe('computing')
    expect(noDated(setFreshness)).toBe(true)
    // no click: the panel asks again by itself
    await screen.findByTestId('terminal-dilution-table', {}, { timeout: 6000 })
    expect(n).toBeGreaterThanOrEqual(2)
  }, 15_000)

  it('the SEC refusing the server is said in plain words: not an error, no Retry, no as-of, and where the filings still are', async () => {
    serve({ [URL]: { status: 'unavailable', sym: 'ZZA', reason: 'refused', http_status: 403, source: SOURCE } })
    const { setFreshness, open } = renderPanel()
    const state = await screen.findByTestId('terminal-dilution-unavailable')
    expect(state.getAttribute('data-kind')).toBe('locked')
    expect(state.getAttribute('role')).toBe('status')
    expect(state.textContent).toContain('SEC filings are not available right now: the SEC\'s website refused the server\'s request (it answered 403).')
    expect(state.textContent).toContain('The site reads the SEC\'s public filing index, and the SEC\'s website did not let the server in. That is not the same as no filings.')
    expect(state.textContent).toContain('The server asks again by itself in about 15 minutes; nothing here needs a retry.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.queryByTestId('terminal-dilution-table')).toBeNull()
    expect(screen.getByTestId('terminal-dilution').getAttribute('data-state')).toBe('unavailable')
    expect(noDated(setFreshness)).toBe(true)
    fireEvent.click(within(state).getByRole('button', { name: 'SEC filings (CF) for ZZA (ZZA CF)' }))
    expect(open).toHaveBeenCalledWith('ZZA CF')
    cleanup()
    serve({ [URL]: { status: 'unavailable', sym: 'ZZA', reason: 'shape', http_status: 200 } })
    renderPanel()
    const shape = (await screen.findByTestId('terminal-dilution-unavailable')).textContent
    expect(shape).toContain('the SEC\'s website answered, but not with a filing index this screen can read.')
    expect(shape).not.toContain('did not let the server in')
  })

  it('the SEC\'s rate limit is said as that, with no Retry; a timeout can be retried', async () => {
    serve({ [URL]: { status: 'failed', sym: 'ZZA', reason: 'rate_limited', http_status: 429 } })
    const { setFreshness } = renderPanel({ sym: 'ZZA' }, { code: 'DILU' })
    const limited = await screen.findByTestId('terminal-dilution-failed')
    expect(limited.getAttribute('data-kind')).toBe('locked')
    expect(limited.getAttribute('role')).toBe('status')
    expect(limited.textContent).toContain('The SEC\'s website said the server was asking too often.')
    expect(limited.textContent).toContain('The server waits about 15 minutes before it asks the SEC again, for any company')
    expect(limited.textContent).toContain('That is not the same as no filings.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    cleanup()
    serve({ [URL]: { status: 'failed', sym: 'ZZA', reason: 'timeout', http_status: null } })
    renderPanel({ sym: 'ZZA' }, { code: 'DILU' })
    const slow = await screen.findByTestId('terminal-dilution-failed')
    expect(slow.getAttribute('data-kind')).toBe('error')
    expect(slow.textContent).toContain('The SEC\'s website did not answer in time.')
    expect(slow.textContent).toContain('The server tries again within a minute; Retry, or run ZZA DILU again.')
    serve({ [URL]: answer() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-dilution-table')).toBeTruthy()
  })

  it('a symbol the SEC lists no filer for is a calm answer that says what it does not mean', async () => {
    serve({ [URL]: { status: 'none', sym: 'ZZA', reason: 'no_cik', http_status: null, source: SOURCE } })
    const { setFreshness } = renderPanel()
    const state = await screen.findByTestId('terminal-dilution-none')
    expect(state.getAttribute('data-kind')).toBe('empty')
    expect(state.getAttribute('role')).toBe('status')
    expect(state.textContent).toContain('The SEC\'s company list has no filer for ZZA.')
    expect(state.textContent).toContain('That is common for funds, ETFs and some foreign listings. It is not a statement that the company has filed nothing.')
    expect(state.textContent).toContain('This screen is about operating companies that file with the SEC.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(noDated(setFreshness)).toBe(true)
    cleanup()
    serve({ [URL]: { status: 'none', sym: 'ZZA', reason: 'no_filings', http_status: 404 } })
    renderPanel()
    expect((await screen.findByTestId('terminal-dilution-none')).textContent).toContain('The SEC\'s filing index lists no filing for ZZA.')
  })

  it('a symbol that is not a stock is said as that', async () => {
    serve({ '/api/research/dilution-watch/I%3ASPX': { status: 'bad_symbol', sym: null } })
    renderPanel({ sym: 'I:SPX' }, { code: 'DILU' })
    const state = await screen.findByTestId('terminal-dilution-bad-symbol')
    expect(state.getAttribute('data-kind')).toBe('input')
    expect(state.textContent).toContain('I:SPX is not a stock symbol this screen can read.')
    expect(state.textContent).toContain('NVDA DILU')
  })
})

describe('DILU the answer', () => {
  it('says what was filed in plain sentences, and the four facts under them', async () => {
    serve({ [URL]: answer() })
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-dilution-table')
    expect(screen.getByTestId('terminal-dilution').getAttribute('data-state')).toBe('ok')
    expect(screen.getByTestId('terminal-dilution-summary').textContent).toBe(
      'A shelf registration filed on Mar 4, 2025 appears to be live: the SEC\'s notice that it took effect is dated Mar 12, 2025, '
      + 'and a shelf may be used for 3 years from then, to about Mar 12, 2028 (an estimate from the dates). '
      + 'ZZA filed 4 offering documents (prospectuses and prospectus supplements) in the last 12 months and 6 in the last 3 years, the latest on Oct 2, 2026. '
      + 'It reported 1 unregistered sale of equity securities (8-K item 3.02) in the last 3 years, the latest on Sep 30, 2026.')
    const facts = [...screen.getByTestId('terminal-dilution-fields').querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])
    expect(facts).toEqual([
      ['Company', 'Acme Example Corp, as the SEC names the filer'],
      ['Shelf registrations', '1 appears to be live (an estimate from the dates)'],
      ['Offering documents', '4 in the last 12 months, 6 in the last 3 years; latest Oct 2, 2026'],
      ['Unregistered sales', '1 in the last 12 months, 1 in the last 3 years; latest Sep 30, 2026'],
    ])
    // the header gets the newest filing date read, and the source
    expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE, age: { asOfDate: '2026-11-05' } })
  })

  it('lists each shelf with when it took effect, how long it may be used and what was filed under it, linked to sec.gov', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    const list = await screen.findByTestId('terminal-dilution-shelves')
    const [item] = within(list).getAllByTestId('terminal-dilution-shelf')
    expect(item.getAttribute('data-state')).toBe('live')
    expect(item.textContent).toBe(`${nb('S-3')} filed Mar 4, 2025. Took effect by the SEC's notice dated Mar 12, 2025. `
      + 'It may be used until about Mar 12, 2028, 3 years from then (an estimate from the dates). 5 offering documents filed under it, the latest Oct 2, 2026.')
    const link = within(item).getByRole('link')
    expect(link.getAttribute('href')).toBe(sec(900))
    expect(link.getAttribute('aria-label')).toBe('S-3 filed Mar 4, 2025, opens on sec.gov in a new tab')
  })

  it('the timeline: the day, the form as a link to the filing on sec.gov in a new tab, and what it is', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    const table = await screen.findByTestId('terminal-dilution-table')
    expect(table.getAttribute('aria-label')).toBe('ZZA share-issuance filings with the SEC, newest first, 6 filings')
    expect([...table.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Filed', 'Form', 'What it is'])
    expect(table.closest('div').hasAttribute('data-fold')).toBe(false)             // three columns: nothing folds away
    const trs = tableRows()
    expect(trs.map((tr) => [tr.getAttribute('data-date'), tr.getAttribute('data-kind')])).toEqual([
      ['2026-10-02', 'offering'], ['2026-10-01', 'fwp'], ['2026-09-30', 'unregistered'], ['2025-03-12', 'effect'],
      ['2025-03-10', 'shelf_amendment'], ['2025-03-04', 'shelf'],
    ])
    const [filed, form, what] = cells(trs[0])
    expect(filed.textContent).toBe(nb('Oct 2, 2026'))
    expect(form.textContent).toBe('424B5')
    expect(lines(what)).toEqual(['Prospectus supplement', 'Under the shelf filed Mar 4, 2025'])
    const link = within(form).getByRole('link')
    expect(link.getAttribute('href')).toBe(sec(1))
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('aria-label')).toBe('424B5 filed Oct 2, 2026, opens on sec.gov in a new tab')
    expect(lines(cells(trs[2])[2])).toEqual(['Unregistered sale of equity securities (8-K item 3.02)', 'Items 1.01, 3.02, 9.01'])
    expect(cells(trs[4])[1].textContent).toBe(nb('S-3/A'))
    expect(lines(cells(trs[5])[2])).toEqual(['Shelf registration'])
    // every link on the panel goes to a filing on sec.gov
    for (const a of screen.getByTestId('terminal-dilution').querySelectorAll('a')) {
      expect(a.getAttribute('href').startsWith('https://www.sec.gov/Archives/edgar/data/')).toBe(true)
    }
    expect(screen.getByTestId('terminal-dilution-count').textContent).toBe('Showing the newest 6 of 6 filings.')
  })

  it('a row whose address is not a filing on sec.gov is drawn without a link', async () => {
    serve({ [URL]: answer({ rows: [row('2026-10-02', '424B5', 'offering', 'Prospectus supplement', { url: 'https://example.test/424b5' })] }) })
    renderPanel()
    await screen.findByTestId('terminal-dilution-table')
    expect(within(tableRows()[0]).queryByRole('link')).toBeNull()
    expect(cells(tableRows()[0])[1].textContent).toBe('424B5')
  })

  it('employee plans and material agreements are listed apart, on request', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-dilution-table')
    const kindsOf = () => tableRows().map((tr) => tr.getAttribute('data-kind'))
    expect(kindsOf()).not.toContain('plan')
    expect(kindsOf()).not.toContain('agreement')
    const notesBefore = [...screen.getByTestId('terminal-dilution-kinds').querySelectorAll('li')].map((li) => li.getAttribute('data-kind'))
    expect(notesBefore).toEqual(['shelf', 'shelf_amendment', 'effect', 'offering', 'fwp', 'unregistered'])
    const more = screen.getByTestId('terminal-dilution-minor')
    expect(more.textContent).toBe('Also list 2 employee plan and material agreement filings')
    expect(more.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(more)
    expect(more.getAttribute('aria-pressed')).toBe('true')
    expect(kindsOf()).toEqual(['offering', 'fwp', 'unregistered', 'agreement', 'effect', 'shelf_amendment', 'shelf', 'plan'])
    expect(screen.getByTestId('terminal-dilution-count').textContent).toBe('Showing the newest 8 of 8 filings.')
    const notes = screen.getByTestId('terminal-dilution-kinds').textContent
    expect(notes).toContain('Employee plan registration. Form S-8: shares for employee benefit plans. Not a market offering.')
    expect(notes).toContain('Most are not about selling shares, and the index does not say what the agreement is.')
    expect(notes).toContain('It is the capacity to sell, not a sale.')
  })

  it('nothing filed is one plain sentence and no table; only plans and agreements says where they are', async () => {
    serve({ [URL]: nothing() })
    renderPanel()
    expect((await screen.findByTestId('terminal-dilution-summary')).textContent)
      .toBe('No shelf registration, offering document or unregistered sale was filed by ZZA in the last 3 years.')
    expect(screen.queryByTestId('terminal-dilution-table')).toBeNull()
    expect(screen.queryByTestId('terminal-dilution-shelves')).toBeNull()
    expect(screen.getByTestId('terminal-dilution-no-rows').textContent).toBe('No filing of the kinds this screen reads in the last 3 years.')
    expect(screen.getByTestId('terminal-dilution-shelf-fact').textContent).toBe('None appears to be live in the last 3 years')
    expect(screen.getByTestId('terminal-dilution-offerings-fact').textContent).toBe('None in the last 3 years')
    expect(screen.getByTestId('terminal-dilution-notes').textContent).toContain('What this panel does not know')
    cleanup()
    serve({ [URL]: nothing({ rows: [row('2024-02-01', 'S-8', 'plan', 'Employee plan registration')], rows_total: 1 }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-dilution-no-rows')).textContent)
      .toBe('Nothing to list but employee plan registrations and material agreements, which are listed apart.')
    expect(screen.getByTestId('terminal-dilution-minor').textContent).toBe('Also list 1 employee plan and material agreement filing')
    fireEvent.click(screen.getByTestId('terminal-dilution-minor'))
    expect(tableRows()).toHaveLength(1)
  })

  it('a long timeline shows 20 rows and the rest on request, and says when the server sent only the newest', async () => {
    serve({ [URL]: answer({ rows: many(26), rows_total: 400, cut: true }) })
    renderPanel()
    await screen.findByTestId('terminal-dilution-table')
    expect(ROWS_SHOWN).toBe(20)
    expect(tableRows()).toHaveLength(20)
    expect(screen.getByTestId('terminal-dilution-count').textContent)
      .toBe('Showing the newest 20 of 26 filings. The server sent the newest 26 of 400 in the last 3 years; the counts above cover all of them.')
    const more = screen.getByTestId('terminal-dilution-more')
    expect(more.textContent).toBe('Show all 26')
    fireEvent.click(more)
    expect(tableRows()).toHaveLength(26)
    expect(more.textContent).toBe('Show 20')
    expect(more.getAttribute('aria-pressed')).toBe('true')
  })

  it('a read that does not reach back three years says so and draws no count it cannot stand behind', async () => {
    serve({ [URL]: answer({
      coverage: { complete: false, from: '2026-01-01', requests: 4, pages_unread: 2 }, shelves: [],
      summary: { live_shelves: 0, newest_live_shelf: null, pending_shelves: 0, newest_pending_shelf: null,
        offerings: { m12: null, y3: null, latest: '2026-11-10' }, unregistered: { m12: null, y3: null, latest: null }, registrations: { m12: null, y3: null, latest: null } },
      rows: [row('2026-11-10', '424B2', 'offering', 'Prospectus supplement')], rows_total: 1,
    }) })
    renderPanel()
    const note = await screen.findByTestId('terminal-dilution-coverage')
    expect(note.getAttribute('role')).toBe('status')
    expect(note.textContent).toBe('ZZA files so often that the server read its filing index back only to Jan 1, 2026, not the full 3 years. '
      + 'A count it cannot stand behind is left out, and a shelf filed before that day would not show here.')
    expect(screen.getByTestId('terminal-dilution-offerings-fact').textContent).toBe('Not counted: the filings read reach back only to Jan 1, 2026; latest Nov 10, 2026')
    expect(screen.getByTestId('terminal-dilution-unregistered-fact').textContent).toBe('Not counted: the filings read reach back only to Jan 1, 2026')
    expect(screen.getByTestId('terminal-dilution-shelf-fact').textContent).toBe('None appears in the filings read')
    expect(screen.getByTestId('terminal-dilution-summary').textContent).not.toMatch(/\b0\b/)
    expect(screen.getByTestId('terminal-dilution-fields').textContent).not.toMatch(/\b0 in\b/)
  })

  it('a fund is told this screen is about operating companies', async () => {
    serve({ [URL]: nothing({ fund_like: true, entity_type: 'investment' }) })
    renderPanel()
    const note = await screen.findByTestId('terminal-dilution-fund')
    expect(note.getAttribute('role')).toBe('note')
    expect(note.textContent).toContain('The SEC\'s index shows ZZA files as a fund. This screen is written for operating companies')
    cleanup()
    serve({ [URL]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-dilution-table')
    expect(screen.queryByTestId('terminal-dilution-fund')).toBeNull()
    expect(screen.queryByTestId('terminal-dilution-coverage')).toBeNull()
  })

  it('the pure helpers of the panel', () => {
    expect(readAtWords('2026-11-18T15:02:11+00:00', '2026-11-18')).toMatch(/^10:02\sAM ET$/)
    expect(readAtWords('2026-11-17T15:02:11+00:00', '2026-11-18')).toMatch(/^10:02\sAM ET on Nov 17, 2026$/)
    expect(readAtWords(null, '2026-11-18')).toBe('')
    const pending = { ...SHELF, filed: '2026-10-20', effective: null, effective_basis: null, expires_estimate: null, state: 'not_effective' }
    expect(shelfWords(dilutionRead(answer({ shelves: [pending, SHELF, { ...SHELF, filed: '2024-05-05' }] }))))
      .toBe('2 appear to be live (an estimate from the dates); 1 filed with no SEC notice that it took effect yet')
    expect(shelfWords(dilutionRead(answer({ shelves: [pending] })))).toBe('None appears to be live; 1 filed with no SEC notice that it took effect yet')
  })
})

describe('DILU says where the answer comes from and what it does not know', () => {
  it('the source, the newest filing date, when the site read it and what the panel does not know are always on screen', async () => {
    serve({ [URL]: answer({ refreshing: true }) })
    const { open } = renderPanel()
    await screen.findByTestId('terminal-dilution-table')
    const notes = screen.getByTestId('terminal-dilution-notes').textContent
    expect(notes).toContain('Source: SEC EDGAR filings, the company\'s public filing index.')
    expect(notes).toContain('The newest filing of any kind in it is dated Nov 5, 2026.')
    expect(notes).toMatch(/The site read it at 10:02\sAM ET, and is reading it again now; the server keeps a company's answer for an hour\./)
    expect(notes).toContain('What this panel does not know: how many shares or dollars a filing covers, how much of a shelf has been used, '
      + 'whether a filing is for common stock, preferred stock, notes or warrants, whether a shelf is for the company or for holders who are selling, '
      + 'and what a proxy statement proposes (more authorized shares, a reverse split).')
    expect(notes).toContain('The filing documents are not read; only the index is.')
    expect(notes).toContain('"Live" is worked out from dates alone: a company\'s own shelf may be used for 3 years after it takes effect '
      + '(one that only registers holders\' sales can run longer), and the index does not show a shelf that was used up or replaced sooner.')
    expect(notes).toContain('color is not used')
    fireEvent.click(screen.getByRole('button', { name: 'SEC filings (CF) for ZZA (ZZA CF)' }))
    expect(open).toHaveBeenCalledWith('ZZA CF')
    fireEvent.click(screen.getByRole('button', { name: 'Filing full-text search (FSRC) for ZZA (ZZA FSRC)' }))
    expect(open).toHaveBeenCalledWith('ZZA FSRC')
  })

  it('a later read that fails keeps the last answer on screen and says so', async () => {
    let n = 0
    jsonFetcher.mockImplementation(async () => { n += 1; if (n === 1) return answer({ refreshing: true }); throw fail(500) })
    renderPanel()
    await screen.findByTestId('terminal-dilution-table')
    const stale = await screen.findByTestId('terminal-dilution-stale-read', {}, { timeout: 20000 })
    expect(stale.textContent).toBe('SEC filings could not be read just now. Showing the last read.')
    expect(screen.getByTestId('terminal-dilution-table')).toBeTruthy()
  }, 30_000)

  it('a new ticker is a new read: one company\'s filings are never drawn under another\'s name', async () => {
    serve({ [URL]: answer(), '/api/research/dilution-watch/ZZB': PENDING })
    const { rerender } = renderPanel()
    await screen.findByTestId('terminal-dilution-table')
    rerender({ sym: 'ZZB' })
    expect(screen.getByTestId('terminal-dilution-loading')).toBeTruthy()
    expect(screen.queryByTestId('terminal-dilution-table')).toBeNull()
    expect(asked()).toEqual([URL, '/api/research/dilution-watch/ZZB'])
  })
})

describe('DILU follows the member\'s theme and takes no side', () => {
  it('the panel and its model hold no hard-coded color, and use no green or red class', () => {
    for (const f of ['DilutionPanel.jsx', 'dilutionModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
      expect(text, f).not.toMatch(/styles\.(up|down|badge_up|badge_down)\b|--success|--danger/)
    }
  })

  it('the table names no fold step and the panel keeps to the shared stylesheet', () => {
    const src = fs.readFileSync(path.join(HERE, 'DilutionPanel.jsx'), 'utf8')
    expect(src).not.toMatch(/data-fold|data-fit/)
    expect([...src.matchAll(/from '(\.\/[^']+\.module\.css)'/g)].map((m) => m[1])).toEqual(['./marketPanels.module.css'])
  })
})

describe('DILU accessibility', () => {
  it('the full panel, nothing filed, the refusal and the rate limit pass axe (WCAG A and AA)', async () => {
    serve({ [URL]: answer() })
    renderPanel()
    await screen.findByTestId('terminal-dilution-table')
    fireEvent.click(screen.getByTestId('terminal-dilution-minor'))
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: nothing({ fund_like: true }) })
    renderPanel()
    await screen.findByTestId('terminal-dilution-no-rows')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: { status: 'unavailable', sym: 'ZZA', reason: 'refused', http_status: 403 } })
    renderPanel()
    await screen.findByTestId('terminal-dilution-unavailable')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: { status: 'failed', sym: 'ZZA', reason: 'rate_limited', http_status: 429 } })
    renderPanel()
    await screen.findByTestId('terminal-dilution-failed')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [URL]: { status: 'none', sym: 'ZZA', reason: 'no_cik' } })
    renderPanel()
    await screen.findByTestId('terminal-dilution-none')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
