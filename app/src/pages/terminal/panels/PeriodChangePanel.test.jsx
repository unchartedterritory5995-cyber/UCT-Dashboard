// PCHG: every US common stock ranked by its percent change between two dates. Rails:
//   * loading, a failed read (error with Retry), a slow first ranking, a paywall and a
//     switched-off route (no Retry), signed out;
//   * "computing" is a working state (the panel asks again), "unavailable" and the server's own
//     refusal are their own states, and none of them is an empty list;
//   * the panel says which trading days the server used, and says so when both dates landed on
//     one day instead of drawing a market of 0% moves;
//   * the two ends of the list, the count that is drawn and the count that is not;
//   * a range chip and the two date boxes pick the range; a bad pair is refused before it is sent;
//   * a symbol loads into the linked panels; row numbers follow the rows on screen;
//   * wave 5: sectors, industries and themes are ranked over the same dates from their own route,
//     with the same states; a group opens the list of its stocks, whose own changes are a second
//     read that fails apart (the stocks stay listed, with no change and never a 0%).
// The fixtures are the route's real shape (api/services/scan_period.py _assemble), made-up tickers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-17' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import PeriodChangePanel, { MAX_ROWS, PAGE_ROWS, PERIOD_CHANGE_CODE, periodChangeUrl, periodGroupsUrl } from './PeriodChangePanel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT whole-market daily closes'
const TODAY = '2026-11-17'
const YTD_URL = periodChangeUrl('2025-12-31', TODAY)
const QTD_URL = periodChangeUrl('2026-09-30', TODAY)
const OK = {
  status: 'ok',
  results: [
    { sym: 'AAA', period_change: 212.5, net_change: 21.25, start_close: 10.0, end_close: 31.25, price: 31.4, volume: 1200000, industry: 'Semiconductors', sector: 'Technology' },
    { sym: 'BBB', period_change: 4.0, net_change: 2.0, start_close: 1250.0, end_close: 1252.0, price: null, volume: null, industry: null, sector: 'Energy' },
    { sym: 'CCC', period_change: 0.0, net_change: 0.0, start_close: 8.0, end_close: 8.0, price: 8.0, volume: 10, industry: null, sector: null },
    { sym: 'DDD', period_change: -61.3, net_change: -30.65, start_close: 50.0, end_close: 19.35, price: 19.3, volume: 90000, industry: 'Biotechnology', sector: 'Healthcare' },
  ],
  count: 4,
  start: 20251231,
  end: 20261116,
  as_of: '2026-11-17T09:41:00-05:00',
  partial: false,
}
const COMPUTING = { status: 'computing', results: [], count: 0, as_of: null }
const many = (n) => Array.from({ length: n }, (_, i) => ({ sym: `T${String(i).padStart(3, '0')}`, period_change: 500 - i, net_change: 5, start_close: 10, end_close: 15, price: 15, volume: 1, industry: 'Banks', sector: 'Financials' }))

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
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

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), open = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <PeriodChangePanel {...props} />
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, rerun, open, publishRows, setFreshness }
}
const rowsOf = () => within(screen.getByTestId('terminal-pchg-table')).getAllByRole('row').slice(1)
const symsOnScreen = () => rowsOf().map((r) => r.getAttribute('data-testid').replace('terminal-pchg-row-', ''))
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('PCHG states', () => {
  it('opens on year to date, shows a loading skeleton and asks for that one range', () => {
    serve({ [YTD_URL]: PENDING })
    renderPanel()
    expect(PERIOD_CHANGE_CODE).toBe('PCHG')
    expect(YTD_URL).toBe('/api/scans/period-change?start=20251231&end=20261117')
    expect(screen.getByTestId('terminal-pchg-loading')).toBeTruthy()
    expect(screen.getByTestId('terminal-pchg').getAttribute('data-range')).toBe('ytd')
    expect(screen.getByTestId('terminal-pchg-range-ytd').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('terminal-pchg-table')).toBeNull()
    expect(asked()).toEqual([YTD_URL])
  })

  it('a failed read (500) is an error with Retry, never an empty list', async () => {
    serve({})
    renderPanel({}, { code: 'PCHX' })
    const err = await screen.findByTestId('terminal-pchg-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The ranking could not be read just now.')
    expect(err.textContent).toContain('That is not the same as an empty list. Retry, or run PCHX again.')
    expect(screen.queryByTestId('terminal-pchg-empty')).toBeNull()
    serve({ [YTD_URL]: OK })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-pchg-table')).toBeTruthy()
  })

  it('a first ranking that ran past the deadline says the server is still working on it', async () => {
    serve({ [YTD_URL]: Object.assign(new Error('deadline'), { timedOut: true }) })
    renderPanel()
    const err = await screen.findByTestId('terminal-pchg-error')
    expect(err.textContent).toContain('The ranking did not answer within 30 seconds.')
    expect(err.textContent).toContain('The server keeps working on it, so Retry usually has it.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('signed out (401) and locked (402, 404) each say so, and only an error can be retried', async () => {
    for (const [status, kind, words] of [
      [401, 'error', 'You are signed out, so the ranking cannot be read. Sign in again.'],
      [402, 'locked', 'The ranking needs a paid plan.'],
      [404, 'locked', 'The ranking is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve({ [YTD_URL]: fail(status) })
      renderPanel()
      const state = await screen.findByTestId('terminal-pchg-error')
      expect(state.getAttribute('data-kind'), String(status)).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), String(status)).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-pchg-empty')).toBeNull()
    }
  })

  it('"computing" says the server is still working: not empty, not an error, and no as-of', async () => {
    serve({ [YTD_URL]: COMPUTING })
    const { setFreshness } = renderPanel()
    const working = await screen.findByTestId('terminal-pchg-computing')
    expect(working.getAttribute('data-kind')).toBe('empty')
    expect(working.getAttribute('role')).toBe('status')
    expect(working.textContent).toContain('Loading, the server is preparing this.')
    expect(working.textContent).toContain('This panel asks again every 5 seconds and fills in on its own.')
    expect(working.textContent).toContain('That is not the same as no stocks.')
    expect(screen.queryByTestId('terminal-pchg-empty')).toBeNull()
    expect(screen.queryByTestId('terminal-pchg-error')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
  })

  it('no data that far back, a refusal and an odd answer are three different states', async () => {
    serve({ [YTD_URL]: { status: 'unavailable', results: [], count: 0, error: 'Market-wide data is not available this far back', as_of: null } })
    renderPanel()
    const none = await screen.findByTestId('terminal-pchg-unavailable')
    expect(none.textContent).toContain('No market-wide prices are on hand for 2025-12-31 to 2026-11-17.')
    expect(none.textContent).toContain('Pick a later start date.')
    cleanup()
    serve({ [YTD_URL]: { status: 'error', results: [], count: 0, error: 'start must be before end' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-pchg-refused')).getAttribute('data-kind')).toBe('input')
    cleanup()
    serve({ [YTD_URL]: { detail: 'upstream said something else' } })
    renderPanel()
    const err = await screen.findByTestId('terminal-pchg-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The ranking could not be read just now.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('a healthy answer with no rows says no stock could be ranked, for which days', async () => {
    serve({ [YTD_URL]: { ...OK, results: [], count: 0 } })
    const { setFreshness } = renderPanel()
    const empty = await screen.findByTestId('terminal-pchg-empty')
    expect(empty.textContent).toContain('No stock could be ranked from 2025-12-31 to 2026-11-16.')
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
  })

  it('two dates that land on one trading day are said so, never drawn as a market of 0% moves', async () => {
    const flat = OK.results.map((r) => ({ ...r, period_change: 0, net_change: 0 }))
    serve({ [YTD_URL]: { ...OK, results: flat, start: 20261116, end: 20261116 } })
    const { setFreshness, publishRows } = renderPanel()
    const same = await screen.findByTestId('terminal-pchg-same-day')
    expect(same.getAttribute('data-kind')).toBe('input')
    expect(same.textContent).toContain('Both dates land on one trading day, 2026-11-16, so there is no change to rank.')
    expect(same.textContent).toContain("Today's close (2026-11-17) is not published yet.")
    expect(screen.queryByTestId('terminal-pchg-table')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    expect(publishRows.mock.calls.every(([rows]) => rows.length === 0)).toBe(true)
  })
})

describe('PCHG populated', () => {
  it('ranks the stocks, says which trading days the server used, and names the end close as the as-of', async () => {
    serve({ [YTD_URL]: OK })
    const { setFreshness, publishRows } = renderPanel()
    await screen.findByTestId('terminal-pchg-table')
    expect(symsOnScreen()).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
    const cells = rowsOf().map((r) => r.textContent)
    for (const s of ['1', 'AAA', '+212.5%', '$10.00 to $31.25', '(+$21.25)', 'Semiconductors']) expect(cells[0]).toContain(s)
    // no industry on file: the sector stands in; neither: it says so
    for (const s of ['2', 'BBB', '+4.0%', '$1,250.00 to $1,252.00', '(+$2.00)', 'Energy']) expect(cells[1]).toContain(s)
    for (const s of ['3', 'CCC', '0.0%', '$8.00 to $8.00', 'Not given']) expect(cells[2]).toContain(s)
    for (const s of ['4', 'DDD', '-61.3%', '$50.00 to $19.35', '(-$30.65)', 'Biotechnology']) expect(cells[3]).toContain(s)
    // a percent the server sends as 212.5 is 212.5%, never 21250%
    expect(document.body.textContent).not.toContain('21250')
    expect(screen.getByTestId('terminal-pchg-totals').textContent)
      .toBe('4 stocks ranked from the close of 2025-12-31 to the close of 2026-11-16: 2 rose, 1 fell, 1 did not move.')
    // the end asked for was today; the server used the last published close
    expect(screen.getByTestId('terminal-pchg-snapped').textContent)
      .toBe("Today's close (2026-11-17) is not published yet, so the list ends at the close of 2026-11-16.")
    expect(screen.getByRole('table', { name: 'Biggest gainers from 2025-12-31 to 2026-11-16, 4 of 4 stocks' })).toBeTruthy()
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE, age: { asOfDate: '2026-11-16' } }))
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC', '$DDD'])
    const method = screen.getByTestId('terminal-pchg-method').textContent
    expect(method).toContain('Closes are adjusted for splits.')
    expect(method).toContain('A stock that has stopped trading since is not listed')
    expect(method).toContain('it is not a forecast or a recommendation.')
    expect(method).toMatch(/Worked out at \d{1,2}:\d{2} [AP]M ET\./)
    expect(screen.queryByTestId('terminal-pchg-partial')).toBeNull()
    expect(screen.queryByTestId('terminal-pchg-coverage')).toBeNull()
    expect(screen.queryByTestId('terminal-pchg-cut')).toBeNull()
    expect(document.body.textContent).not.toMatch(/[—–]/)
    expect(asked().every((url) => url === YTD_URL)).toBe(true)
  })

  it('says when the server moved the start date, and when the list came from the bar store', async () => {
    const url = periodChangeUrl('2026-10-31', '2026-11-13')
    serve({ [url]: { ...OK, start: 20261030, end: 20261113, partial: true, coverage: { evaluated: 5300, answered: 4812, dropped: 78, not_computable: 410, dropped_symbols: [] } } })
    renderPanel({ start: '2026-10-31', end: '2026-11-13' })
    await screen.findByTestId('terminal-pchg-table')
    expect(screen.getByTestId('terminal-pchg').getAttribute('data-range')).toBe('dates')
    expect(screen.getByTestId('terminal-pchg-snapped').textContent.trim())
      .toBe('2026-10-31 has no published close, so the start is the last trading day before it, 2026-10-30.')
    expect(screen.getByTestId('terminal-pchg-partial').textContent).toContain('companies that have since stopped trading are missing')
    expect(screen.getByTestId('terminal-pchg-method').textContent).not.toContain('A stock that has stopped trading since is not listed')
    expect(screen.getByTestId('terminal-pchg-coverage').textContent)
      .toContain('The server checked 5,300 common stocks and ranked 4,812. 410 had no close on one of the two days. 78 were left out on purpose')
    // the typed dates fill the two boxes, and no range chip is pressed
    expect(screen.getByTestId('terminal-pchg-from').value).toBe('2026-10-31')
    expect(screen.getByTestId('terminal-pchg-to').value).toBe('2026-11-13')
    expect(screen.getAllByRole('button', { pressed: true }).map((b) => b.textContent)).toEqual(['Stocks', 'Biggest gainers'])
    expect(asked()).toEqual([url])
  })

  it('the other end of the list, and a long list fifty at a time up to the cap', async () => {
    serve({ [YTD_URL]: { ...OK, results: many(300), count: 300 } })
    const { publishRows } = renderPanel({ side: 'LOSERS' })
    await screen.findByTestId('terminal-pchg-table')
    expect(screen.getByTestId('terminal-pchg-side-losers').getAttribute('aria-pressed')).toBe('true')
    expect(rowsOf()).toHaveLength(PAGE_ROWS)
    expect(symsOnScreen().slice(0, 2)).toEqual(['T299', 'T298'])
    expect(screen.getByTestId('terminal-pchg-cut').textContent.trim()).toBe('Showing the 50 biggest losers of 300 stocks.')
    expect(screen.getByRole('table', { name: 'Biggest losers from 2025-12-31 to 2026-11-16, 50 of 300 stocks' })).toBeTruthy()
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(50)
    fireEvent.click(screen.getByTestId('terminal-pchg-side-gainers'))
    expect(symsOnScreen().slice(0, 2)).toEqual(['T000', 'T001'])
    expect(screen.getByTestId('terminal-pchg-more').textContent).toBe('Show 50 more')
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByTestId('terminal-pchg-more'))
    expect(rowsOf()).toHaveLength(MAX_ROWS)
    expect(screen.queryByTestId('terminal-pchg-more')).toBeNull()
    expect(screen.getByTestId('terminal-pchg-cut').textContent)
      .toBe('Showing the 250 biggest gainers of 300 stocks. This panel draws 250 at most; the other end of the list is under Biggest losers.')
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(250)
  })

  it('a symbol loads into the linked panels', async () => {
    serve({ [YTD_URL]: OK })
    const { run } = renderPanel()
    await screen.findByTestId('terminal-pchg-table')
    fireEvent.click(screen.getByTestId('panel-symbol-DDD'))
    expect(run).toHaveBeenCalledWith('$DDD')
  })
})

describe('PCHG picking a range', () => {
  it('the typed range seeds the chip, and a chip reads its own range only once it is picked', async () => {
    serve({ [YTD_URL]: OK, [QTD_URL]: { ...OK, start: 20260930 } })
    const { rerun } = renderPanel({ range: 'QTD' })
    await screen.findByTestId('terminal-pchg-table')
    expect(screen.getByTestId('terminal-pchg').getAttribute('data-range')).toBe('qtd')
    expect(screen.getByTestId('terminal-pchg-totals').textContent).toContain('from the close of 2026-09-30 to the close of 2026-11-16')
    expect(asked()).toEqual([QTD_URL])
    fireEvent.click(screen.getByTestId('terminal-pchg-range-ytd'))
    await waitFor(() => expect(screen.getByTestId('terminal-pchg-totals').textContent).toContain('from the close of 2025-12-31'))
    expect(screen.getByTestId('terminal-pchg-range-ytd').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-pchg-range-qtd').getAttribute('aria-pressed')).toBe('false')
    expect(asked()).toContain(YTD_URL)
    // outside a registered panel nothing is written back: the chip is plain component state
    expect(rerun).not.toHaveBeenCalled()
  })

  it('inside a panel whose code does not take the words, a chip still switches and writes nothing', async () => {
    // MOST is a registered code whose market variant takes UP and DOWN, not QTD.
    serve({ [YTD_URL]: OK, [QTD_URL]: OK })
    const { rerun } = renderPanel({}, { code: 'MOST' })
    await screen.findByTestId('terminal-pchg-table')
    fireEvent.click(screen.getByTestId('terminal-pchg-range-qtd'))
    await waitFor(() => expect(asked()).toContain(QTD_URL))
    expect(rerun).not.toHaveBeenCalled()
    // back to the default range is the bare command, which every code takes
    fireEvent.click(screen.getByTestId('terminal-pchg-range-ytd'))
    expect(rerun).toHaveBeenLastCalledWith('MOST')
  })

  it('the two date boxes rank a custom range, and a bad pair is refused before anything is asked', async () => {
    const url = periodChangeUrl('2026-01-02', '2026-06-30')
    serve({ [YTD_URL]: OK, [url]: { ...OK, start: 20260102, end: 20260630 } })
    renderPanel()
    await screen.findByTestId('terminal-pchg-table')
    // nothing picked
    fireEvent.click(screen.getByTestId('terminal-pchg-rank'))
    expect(screen.getByTestId('terminal-pchg-form-error').textContent).toBe('Pick a start date. The end date is today when it is left empty.')
    // out of order
    fireEvent.change(screen.getByTestId('terminal-pchg-from'), { target: { value: '2026-06-30' } })
    fireEvent.change(screen.getByTestId('terminal-pchg-to'), { target: { value: '2026-01-02' } })
    fireEvent.click(screen.getByTestId('terminal-pchg-rank'))
    const error = screen.getByTestId('terminal-pchg-form-error')
    expect(error.textContent).toBe('The start date 2026-06-30 has to be before the end date 2026-01-02.')
    expect(error.getAttribute('role')).toBe('alert')
    expect(screen.getByTestId('terminal-pchg-from').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByTestId('terminal-pchg-from').getAttribute('aria-describedby')).toBe(error.id)
    expect(asked().every((u) => u === YTD_URL)).toBe(true)
    // the year-to-date list stays on screen while the form is wrong
    expect(screen.getByTestId('terminal-pchg-totals').textContent).toContain('2025-12-31')
    // a good pair
    fireEvent.change(screen.getByTestId('terminal-pchg-from'), { target: { value: '2026-01-02' } })
    fireEvent.change(screen.getByTestId('terminal-pchg-to'), { target: { value: '2026-06-30' } })
    fireEvent.click(screen.getByTestId('terminal-pchg-rank'))
    await waitFor(() => expect(screen.getByTestId('terminal-pchg-totals').textContent).toContain('from the close of 2026-01-02 to the close of 2026-06-30'))
    expect(screen.queryByTestId('terminal-pchg-form-error')).toBeNull()
    expect(screen.queryByTestId('terminal-pchg-snapped')).toBeNull()
    expect(screen.getByTestId('terminal-pchg').getAttribute('data-range')).toBe('dates')
    expect(asked()).toContain(url)
  })

  it('typed dates that cannot be a range say why, and nothing is asked', () => {
    serve({})
    renderPanel({ start: '2026-06-30', end: '2026-01-02' }, { code: 'PCHX' })
    const bad = screen.getByTestId('terminal-pchg-bad-dates')
    expect(bad.getAttribute('data-kind')).toBe('input')
    expect(bad.textContent).toContain('The start date 2026-06-30 has to be before the end date 2026-01-02.')
    expect(bad.textContent).toContain('PCHX YTD')
    expect(screen.getByTestId('terminal-pchg').getAttribute('data-range')).toBe('invalid')
    cleanup()
    renderPanel({ start: '2026-01-02', end: '2026-12-31' })
    expect(screen.getByTestId('terminal-pchg-bad-dates').textContent).toContain('The end date 2026-12-31 is after today (2026-11-17).')
    cleanup()
    renderPanel({ start: '2026-02-30' })
    expect(screen.getByTestId('terminal-pchg-bad-dates').textContent).toContain('"2026-02-30" is not a date this panel can read.')
    expect(asked()).toEqual([])
  })
})

// ── wave 5: sectors, industries and themes ──────────────────────────────────────────────────
// The groups route's real shape (api/services/scan_period.py get_period_change_groups).
const SECTORS_URL = periodGroupsUrl('2025-12-31', TODAY, 'sector')
const INDUSTRIES_URL = periodGroupsUrl('2025-12-31', TODAY, 'industry')
const THEMES_URL = periodGroupsUrl('2025-12-31', TODAY, 'theme')
const SECTORS = {
  status: 'ok',
  group: 'sector',
  results: [
    { name: 'Technology', period_change: 38.25, count: 3, members: ['AAA', 'CCC', 'FFF'] },
    { name: 'Energy', period_change: 4.0, count: 1, members: ['BBB'] },
    { name: 'Healthcare', period_change: -61.3, count: 1, members: ['DDD'] },
  ],
  count: 3,
  start: 20251231,
  end: 20261116,
  as_of: '2026-11-17T09:41:00-05:00',
}
const groupNames = () => rowsOf().map((r) => r.getAttribute('data-name'))

describe('PCHG sectors, industries and themes', () => {
  it('the typed word ranks sectors from the groups route alone, with each sector\'s stock count', async () => {
    serve({ [SECTORS_URL]: SECTORS })
    const { setFreshness, publishRows } = renderPanel({ unit: 'SECTORS' })
    await screen.findByTestId('terminal-pchg-table')
    expect(SECTORS_URL).toBe('/api/scans/period-change-groups?start=20251231&end=20261117&group=sector')
    expect(screen.getByTestId('terminal-pchg').getAttribute('data-unit')).toBe('sector')
    expect(screen.getByTestId('terminal-pchg-unit-sector').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-pchg-unit-stocks').getAttribute('aria-pressed')).toBe('false')
    expect(groupNames()).toEqual(['Technology', 'Energy', 'Healthcare'])
    const cells = rowsOf().map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))
    expect(cells).toEqual([['1Technology', '+38.3%', '3'], ['2Energy', '+4.0%', '1'], ['3Healthcare', '-61.3%', '1']])
    expect(within(screen.getByTestId('terminal-pchg-table')).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Sector', 'Change', 'Stocks'])
    expect(screen.getByTestId('terminal-pchg-totals').textContent)
      .toBe('3 sectors ranked from the close of 2025-12-31 to the close of 2026-11-16: 2 rose, 1 fell.')
    // the dates snap exactly as they do for stocks, and the panel says which days were used
    expect(screen.getByTestId('terminal-pchg-snapped').textContent)
      .toBe("Today's close (2026-11-17) is not published yet, so the list ends at the close of 2026-11-16.")
    expect(screen.getByRole('table', { name: 'Biggest gainers from 2025-12-31 to 2026-11-16, 3 of 3 sectors' })).toBeTruthy()
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE, age: { asOfDate: '2026-11-16' } }))
    const method = screen.getByTestId('terminal-pchg-method').textContent
    expect(method).toContain('A sector\'s change is the average of its stocks\' changes, each stock counting the same, after its best tenth of stocks (at least one) is capped')
    expect(method).toContain('a stock with none on file is in no sector')
    expect(method).toContain('it is not a forecast or a recommendation.')
    expect(screen.queryByTestId('terminal-pchg-partial')).toBeNull()
    // a list of groups names no stock, so no stock row is published and the stock route is not asked
    expect(publishRows.mock.calls.every(([rows]) => rows.length === 0)).toBe(true)
    expect(asked().every((url) => url === SECTORS_URL)).toBe(true)
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('a chip switches what is ranked, each from its own read, and the other end of the list still applies', async () => {
    serve({ [YTD_URL]: OK, [SECTORS_URL]: SECTORS, [INDUSTRIES_URL]: { ...SECTORS, group: 'industry', results: [{ name: 'Semiconductors', period_change: 12.5, count: 40, members: [] }] },
      [THEMES_URL]: { ...SECTORS, group: 'theme', results: [{ name: 'AI, Chips & Power', period_change: -2, count: 9, members: ['AAA'] }] } })
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-pchg-table')
    expect(asked()).toEqual([YTD_URL])
    fireEvent.click(screen.getByTestId('terminal-pchg-unit-sector'))
    await waitFor(() => expect(screen.getByTestId('terminal-pchg-totals').textContent).toContain('3 sectors ranked'))
    fireEvent.click(screen.getByTestId('terminal-pchg-side-losers'))
    expect(groupNames()).toEqual(['Healthcare', 'Energy', 'Technology'])
    expect(screen.getByRole('table', { name: 'Biggest losers from 2025-12-31 to 2026-11-16, 3 of 3 sectors' })).toBeTruthy()
    fireEvent.click(screen.getByTestId('terminal-pchg-unit-industry'))
    await waitFor(() => expect(screen.getByTestId('terminal-pchg-totals').textContent).toBe('1 industry ranked from the close of 2025-12-31 to the close of 2026-11-16: 1 rose, 0 fell.'))
    fireEvent.click(screen.getByTestId('terminal-pchg-unit-theme'))
    await waitFor(() => expect(groupNames()).toEqual(['AI, Chips & Power']))
    expect(screen.getByTestId('terminal-pchg-method').textContent).toContain('These are the UCT themes; a theme with none of its stocks in that list is not shown.')
    expect(asked()).toEqual(expect.arrayContaining([SECTORS_URL, INDUSTRIES_URL, THEMES_URL]))
    // back to stocks is the stock route again
    fireEvent.click(screen.getByTestId('terminal-pchg-unit-stocks'))
    await waitFor(() => expect(screen.getByTestId('terminal-pchg-totals').textContent).toContain('4 stocks ranked'))
    // outside a registered panel nothing is written back
    expect(rerun).not.toHaveBeenCalled()
  })

  it('computing, both dates on one day, no group ranked and a failed read are each said in the group\'s own words', async () => {
    serve({ [SECTORS_URL]: { status: 'computing', group: 'sector', results: [], count: 0, error: null } })
    renderPanel({ unit: 'sector' })
    expect((await screen.findByTestId('terminal-pchg-computing')).textContent).toContain('That is not the same as no sectors.')
    cleanup()
    serve({ [SECTORS_URL]: { ...SECTORS, start: 20261116, end: 20261116, results: SECTORS.results.map((r) => ({ ...r, period_change: 0 })) } })
    renderPanel({ unit: 'sector' })
    expect((await screen.findByTestId('terminal-pchg-same-day')).textContent).toContain('Both dates land on one trading day, 2026-11-16')
    expect(screen.queryByTestId('terminal-pchg-table')).toBeNull()
    cleanup()
    serve({ [THEMES_URL]: { ...SECTORS, group: 'theme', results: [] } })
    renderPanel({ unit: 'THEMES' })
    expect((await screen.findByTestId('terminal-pchg-empty')).textContent).toContain('No theme could be ranked from 2025-12-31 to 2026-11-16.')
    cleanup()
    // an answer for another group is not this read: an error with Retry, never a list
    serve({ [INDUSTRIES_URL]: SECTORS })
    renderPanel({ unit: 'industry' })
    const err = await screen.findByTestId('terminal-pchg-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    serve({ [SECTORS_URL]: fail(402) })
    renderPanel({ unit: 'sector' })
    expect((await screen.findByTestId('terminal-pchg-error')).getAttribute('data-kind')).toBe('locked')
  })

  it('a range older than the whole-market history says what that does to every group', async () => {
    const url = periodGroupsUrl('1999-01-04', '2000-03-10', 'sector')
    serve({ [url]: { ...SECTORS, start: 19990104, end: 20000310 } })
    renderPanel({ start: '1999-01-04', end: '2000-03-10', unit: 'sector' })
    await screen.findByTestId('terminal-pchg-table')
    const note = screen.getByTestId('terminal-pchg-partial').textContent
    expect(note).toContain('companies that have since stopped trading are missing from every sector')
    expect(note).toContain('The server does not say when it did this for sectors.')
  })

  it('a sector opens its stocks, each with its own change from the stock ranking, and Back returns to the row it came from', async () => {
    serve({ [SECTORS_URL]: SECTORS, [YTD_URL]: OK })
    const { publishRows, run } = renderPanel({ unit: 'sector' })
    await screen.findByTestId('terminal-pchg-table')
    expect(asked()).toEqual([SECTORS_URL])
    fireEvent.click(screen.getByRole('button', { name: 'Technology: list its stocks' }))
    const members = await screen.findByTestId('terminal-pchg-members')
    // only now is the stock ranking read
    expect(asked()).toContain(YTD_URL)
    expect(screen.queryByTestId('terminal-pchg-table')).toBeNull()
    expect(screen.getByTestId('terminal-pchg-group-head').textContent)
      .toBe('Technology: +38.3% from the close of 2025-12-31 to the close of 2026-11-16, 3 stocks.')
    const rows = within(members).getAllByRole('row').slice(1).map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))
    // biggest gain first; FFF is in the sector but not in the stock ranking: no percent, never a 0
    expect(rows.map((r) => r[1])).toEqual(['+212.5%', '+0.0%', 'n/a'])
    for (const s of ['1', 'AAA']) expect(rows[0][0]).toContain(s)
    expect(rows[0][2]).toBe('$10.00 to $31.25 (+$21.25)')
    expect(rows[2][0]).toContain('FFF')
    expect(rows[2][2]).toBe('n/a')
    expect(screen.getByRole('table', { name: 'The stocks in Technology from 2025-12-31 to 2026-11-16, biggest gainers first, 3 of 3' })).toBeTruthy()
    expect(screen.getByTestId('terminal-pchg-members-method').textContent).toContain('it is not the plain average of this list')
    expect(screen.queryByTestId('terminal-pchg-members-failed')).toBeNull()
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$CCC', '$FFF'])
    fireEvent.click(screen.getByTestId('panel-symbol-CCC'))
    expect(run).toHaveBeenCalledWith('$CCC')
    // the keyboard went to Back, and comes back to the sector's own row
    const back = screen.getByTestId('terminal-pchg-back')
    expect(back.textContent).toBe('Back to all sectors')
    expect(document.activeElement).toBe(back)
    fireEvent.click(back)
    expect(groupNames()).toEqual(['Technology', 'Energy', 'Healthcare'])
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Technology: list its stocks' })))
    expect(publishRows).toHaveBeenLastCalledWith([])
  })

  it('an opened group can be opened as its own panel (GRP), on a one-click range only', async () => {
    const qtdSectors = periodGroupsUrl('2026-09-30', TODAY, 'sector')
    serve({ [SECTORS_URL]: SECTORS, [YTD_URL]: OK, [qtdSectors]: SECTORS, [QTD_URL]: OK })
    const { open } = renderPanel({ unit: 'sector' })
    await screen.findByTestId('terminal-pchg-table')
    fireEvent.click(screen.getByRole('button', { name: 'Technology: list its stocks' }))
    await screen.findByTestId('terminal-pchg-members')
    fireEvent.click(screen.getByRole('button', { name: 'Open Technology as its own panel, with RS and flow (GRP SECTOR TECHNOLOGY)' }))
    expect(open).toHaveBeenLastCalledWith('GRP SECTOR TECHNOLOGY')
    // the range goes with it
    fireEvent.click(screen.getByTestId('terminal-pchg-range-qtd'))
    await screen.findByTestId('terminal-pchg-table')
    fireEvent.click(screen.getByRole('button', { name: 'Technology: list its stocks' }))
    await screen.findByTestId('terminal-pchg-members')
    fireEvent.click(screen.getByRole('button', { name: /^Open Technology as its own panel/ }))
    expect(open).toHaveBeenLastCalledWith('GRP SECTOR TECHNOLOGY QTD')
    cleanup()
    // two typed dates are not a range GRP takes, so the door is not offered there
    const dated = periodGroupsUrl('2026-01-02', '2026-06-30', 'sector')
    serve({ [dated]: { ...SECTORS, start: 20260102, end: 20260630 }, [periodChangeUrl('2026-01-02', '2026-06-30')]: OK })
    renderPanel({ start: '2026-01-02', end: '2026-06-30', unit: 'sector' })
    await screen.findByTestId('terminal-pchg-table')
    fireEvent.click(screen.getByRole('button', { name: 'Technology: list its stocks' }))
    await screen.findByTestId('terminal-pchg-members')
    expect(screen.queryByRole('button', { name: /as its own panel/ })).toBeNull()
  })

  it('when the stocks\' own changes cannot be read the stocks are still listed, with no change and a Retry', async () => {
    serve({ [SECTORS_URL]: SECTORS })
    renderPanel({ unit: 'sector' })
    await screen.findByTestId('terminal-pchg-table')
    fireEvent.click(screen.getByRole('button', { name: 'Technology: list its stocks' }))
    const failed = await screen.findByTestId('terminal-pchg-members-failed')
    expect(failed.textContent).toContain('Each stock\'s own change could not be read just now.')
    expect(failed.textContent).toContain('The stocks are listed without it; that is not a change of 0%.')
    const cells = within(screen.getByTestId('terminal-pchg-members')).getAllByRole('row').slice(1).map((r) => r.querySelectorAll('td')[1].textContent)
    expect(cells).toEqual(['n/a', 'n/a', 'n/a'])
    expect(document.body.textContent).not.toContain('0.0%')
    // the sector's own figure is still shown: it came from the read that worked
    expect(screen.getByTestId('terminal-pchg-group-head').textContent).toContain('Technology: +38.3%')
    serve({ [SECTORS_URL]: SECTORS, [YTD_URL]: OK })
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByTestId('terminal-pchg-members-failed')).toBeNull())
    expect(within(screen.getByTestId('terminal-pchg-members')).getAllByRole('row').slice(1).map((r) => r.querySelectorAll('td')[1].textContent))
      .toEqual(['+212.5%', '+0.0%', 'n/a'])
  })

  it('a long group list is drawn fifty at a time, and counted', async () => {
    const results = Array.from({ length: 120 }, (_, i) => ({ name: `Industry ${String(i).padStart(3, '0')}`, period_change: 300 - i, count: 5, members: [] }))
    serve({ [INDUSTRIES_URL]: { ...SECTORS, group: 'industry', results, count: 120 } })
    renderPanel({ unit: 'INDUSTRIES' })
    await screen.findByTestId('terminal-pchg-table')
    expect(rowsOf()).toHaveLength(PAGE_ROWS)
    expect(screen.getByTestId('terminal-pchg-cut').textContent.trim()).toBe('Showing the 50 biggest gainers of 120 industries.')
    fireEvent.click(screen.getByTestId('terminal-pchg-more'))
    expect(rowsOf()).toHaveLength(100)
    fireEvent.click(screen.getByTestId('terminal-pchg-more'))
    expect(rowsOf()).toHaveLength(120)
    expect(screen.queryByTestId('terminal-pchg-cut')).toBeNull()
    // a group the server sent no stock list for says so when opened
    fireEvent.click(screen.getByRole('button', { name: 'Industry 000: list its stocks' }))
    expect((await screen.findByTestId('terminal-pchg-members-empty')).textContent).toContain('The server sent no stock list for Industry 000.')
  })
})

describe('PCHG follows the member\'s theme', () => {
  it('the panel, its model and its form styles hold no hard-coded color', () => {
    for (const f of ['PeriodChangePanel.jsx', 'periodChangeModel.js', 'panelForm.module.css']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('PCHG accessibility', () => {
  it('the list and the form with an error pass axe (WCAG A and AA)', async () => {
    serve({ [YTD_URL]: OK })
    renderPanel()
    await screen.findByTestId('terminal-pchg-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-pchg-rank'))
    expect(screen.getByTestId('terminal-pchg-form-error')).toBeTruthy()
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)

  it('the sector list and one sector\'s stocks pass axe (WCAG A and AA)', async () => {
    serve({ [SECTORS_URL]: SECTORS, [YTD_URL]: OK })
    renderPanel({ unit: 'sector' })
    await screen.findByTestId('terminal-pchg-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByRole('button', { name: 'Technology: list its stocks' }))
    await screen.findByTestId('terminal-pchg-members')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)
})
