// MNA: mergers and acquisitions. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan (locked), a timeout and an answer not of
//     the route's shape: none is "no deals";
//   * "computing" is said and the panel asks again every 3 seconds on its own;
//   * a provider that refuses the site's plan says so with no Retry; the server's failed read offers Retry;
//   * an answered, empty list is an answer;
//   * each deal: the acquirer (a followed symbol loads through the kit; any other is plain text), the target (a
//     private one says it has no listed symbol), the day and the SEC filing link (a new tab, named);
//   * one company: its own read and count line, what the name search did and left out;
//   * a cut list and dropped rows are said; the source and read time in words; no hard-coded color; axe.
// Every symbol, name, date and link is invented.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import MergersPanel from './MergersPanel'
import { MNA_SOURCE, mnaUrl } from './mergersModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LINK = 'https://www.sec.gov/Archives/edgar/data/1/made-up.htm'
const party = (sym, name, covered = true) => ({ sym, name, cik: sym ? '1' : null, covered })
const deal = (date, acquirer, target, over = {}) => ({ date, accepted_at: `${date} 16:20:38`, acquirer, target, link: LINK, ...over })
const LATEST = (over = {}) => ({ status: 'ok', scope: 'latest', read_at: '2031-03-12T14:02:00+00:00', source: MNA_SOURCE, check: null, pages_read: 1,
  cut: false, dropped: 0, deals: [
    deal('2031-03-12', party('QQZA', 'Quillfeather Mills Inc'), party(null, 'Tinmoor Works LLC', false)),
    deal('2031-03-10', party('QQZX', 'Ashgrove Partners', false), party('QQZB', 'Bramblecourt Foods'), { link: null }),
  ], ...over })
const COMPANY = (over = {}) => LATEST({ scope: 'company', sym: 'QQZA', name: 'Quillfeather Mills, Inc.', search: 'ok', other_companies: 2, from_latest: 1, ...over })

const httpError = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status, ...extra })
const PENDING = Symbol('pending')
function serve(routes) {
  jsonFetcher.mockImplementation((u) => {
    const hit = typeof routes[u] === 'function' ? routes[u]() : routes[u]
    if (hit === undefined) return Promise.reject(httpError(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
function renderPanel(props = {}, { code = null, run = vi.fn(), setFreshness = vi.fn() } = {}) {
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><MergersPanel {...props} /></TerminalPanelContext.Provider>
            : <MergersPanel {...props} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, setFreshness, container: view.container }
}
const MARKET = mnaUrl(null)
const ONE = mnaUrl('QQZA')
const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)
const lastReport = (setFreshness) => setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('MNA states', () => {
  it('a loading skeleton; the market list or one company\'s by what is asked', () => {
    serve({ [MARKET]: PENDING, [ONE]: PENDING })
    renderPanel()
    expect(screen.getByTestId('terminal-mna-loading').textContent).toContain('Loading the latest deals')
    cleanup()
    renderPanel({ sym: ' qqza ' })
    expect(screen.getByTestId('terminal-mna-loading').textContent).toContain('Loading the deals naming QQZA')
    expect([...new Set(jsonFetcher.mock.calls.map(([u]) => u))]).toEqual([MARKET, ONE])
  })

  it('a failed read is an error with Retry, never "no deals"', async () => {
    serve({})
    renderPanel()
    const err = await screen.findByTestId('terminal-mna-error')
    expect(err.textContent).toContain('Mergers and acquisitions could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no deals.')
    serve({ [MARKET]: LATEST() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-mna-deals')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and an unreadable answer each say so; only an error can be retried', async () => {
    for (const [hit, kind, words] of [
      [httpError(401), 'error', 'You are signed out, so mergers and acquisitions cannot be read. Sign in again.'],
      [httpError(0, { timedOut: true }), 'error', 'Mergers and acquisitions did not answer within 30 seconds.'],
      [httpError(402), 'locked', 'Mergers and acquisitions needs a paid plan.'],
      [{ status: 'ok' }, 'error', 'Mergers and acquisitions came back in a shape this panel cannot read.'],
    ]) {
      serve({ [MARKET]: hit })
      renderPanel()
      const box = await screen.findByTestId('terminal-mna-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      cleanup()
    }
  })

  it('"computing" is said, and the panel asks again every 3 seconds until it fills in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let body = { status: 'computing', scope: 'latest' }
    serve({ [MARKET]: () => body })
    renderPanel()
    expect((await screen.findByTestId('terminal-mna-computing')).textContent).toContain('This panel asks again every 3 seconds')
    body = LATEST()
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    await waitFor(() => expect(screen.getByTestId('terminal-mna-deals')).toBeTruthy())
  })

  it('a provider that refuses the site\'s plan says so with no Retry; the server\'s failed read offers Retry', async () => {
    serve({ [MARKET]: { status: 'unavailable', reason: 'not_in_plan', http_status: 402, scope: 'latest' } })
    renderPanel()
    const box = await screen.findByTestId('terminal-mna-unavailable')
    expect(box.getAttribute('data-kind')).toBe('locked')
    expect(box.textContent).toContain('Mergers and acquisitions are not available from our data provider.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    serve({ [MARKET]: { status: 'failed', reason: 'source', scope: 'latest' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-mna-source')).textContent).toContain('That is not the same as no deals.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('an answered, empty list is an answer', async () => {
    serve({ [MARKET]: LATEST({ deals: [] }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-mna-none')).textContent).toContain('No deal is listed in the latest filings.')
  })
})

describe('MNA the deals', () => {
  it('each deal: the acquirer, the target, the day and the filing; a followed symbol loads, another is plain text', async () => {
    serve({ [MARKET]: LATEST() })
    const { run, setFreshness } = renderPanel({}, { code: 'MNA' })
    expect((await screen.findByTestId('terminal-mna-count')).textContent).toBe('The latest 2 deals, newest first, filed Mar 10, 2031 to Mar 12, 2031.')
    const rows = within(screen.getByTestId('terminal-mna-deals')).getAllByTestId('terminal-mna-row')
    expect(cells(rows[0])).toEqual(['QQZAQuillfeather Mills Inc', 'Tinmoor Works LLCNo listed symbol', 'Mar 12, 2031SEC filing'])
    expect(cells(rows[1])).toEqual(['QQZXAshgrove Partners', 'Bramblecourt FoodsQQZB', 'Mar 10, 2031'])
    const link = within(rows[0]).getByRole('link')
    expect(link.getAttribute('href')).toBe(LINK)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('aria-label')).toBe('The SEC filing for QQZA and Tinmoor Works LLC, opens sec.gov in a new tab')
    fireEvent.click(screen.getByTestId('panel-symbol-QQZA'))
    expect(run).toHaveBeenCalledWith('$QQZA')
    fireEvent.click(screen.getByTestId('panel-symbol-QQZB'))
    expect(run).toHaveBeenCalledWith('$QQZB')
    expect(screen.queryByTestId('panel-symbol-QQZX')).toBeNull()
    expect(lastReport(setFreshness)).toMatchObject({ source: MNA_SOURCE })
    expect(screen.getByTestId('terminal-mna-method').textContent).toContain('The server reads the newest filings at most once an hour.')
  })

  it('one company: its count line and what the name search did and left out', async () => {
    serve({ [ONE]: COMPANY() })
    renderPanel({ sym: 'QQZA' })
    expect((await screen.findByTestId('terminal-mna-count')).textContent).toBe('2 deals naming QQZA (Quillfeather Mills, Inc.), newest first.')
    expect(screen.getByTestId('terminal-mna-search').textContent).toBe('2 more deals matched the name search but name a different company; they are not shown.')
    expect(screen.getByTestId('terminal-mna').getAttribute('data-sym')).toBe('QQZA')
    cleanup()
    serve({ [ONE]: COMPANY({ search: 'no_name', other_companies: 0, deals: [] }) })
    renderPanel({ sym: 'QQZA' })
    expect((await screen.findByTestId('terminal-mna-none')).textContent).toContain('No deal naming QQZA (Quillfeather Mills, Inc.) is listed.')
    expect(screen.getByTestId('terminal-mna-search').textContent).toContain('so only the latest filings were looked through, by symbol')
  })

  it('a cut list, dropped rows and a failed later look are said', async () => {
    serve({ [MARKET]: LATEST({ cut: true, dropped: 2, check: { state: 'failed', reason: 'source' } }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-mna-note')).textContent).toBe('The feed holds older deals than these. 2 rows in the answer had no day or no acquirer symbol and are not shown.')
    expect(screen.getByTestId('terminal-mna-check').textContent).toContain('this is the last list read')
  })
})

describe('MNA on a panel that follows a stock', () => {
  it('bare MNA there is the stock\'s deals, with a chip to the latest deals that writes SYM MNA MARKET', async () => {
    serve({ [ONE]: COMPANY() })
    const rerun = vi.fn()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          <TerminalPanelContext.Provider value={{ code: 'MNA', density: 'comfortable', inset: true }}><MergersPanel sym="QQZA" /></TerminalPanelContext.Provider>
        </PanelListContext.Provider>
      </SWRConfig>,
    )
    await screen.findByTestId('terminal-mna-deals')
    expect(screen.getByTestId('terminal-mna-view-stock').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-mna-view-market'))
    expect(rerun).toHaveBeenCalledWith('QQZA MNA MARKET')
  })

  it('MNA MARKET there reads the latest deals; outside the shell the chips switch in state', async () => {
    serve({ [MARKET]: LATEST(), [ONE]: PENDING })
    renderPanel({ sym: 'QQZA', view: 'market' })
    expect((await screen.findByTestId('terminal-mna-count')).textContent).toContain('The latest 2 deals')
    expect(screen.getByTestId('terminal-mna-view-market').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-mna-view-stock'))
    expect(screen.getByTestId('terminal-mna-loading').textContent).toContain('Loading the deals naming QQZA')
    expect([...new Set(jsonFetcher.mock.calls.map(([u]) => u))]).toEqual([MARKET, ONE])
  })

  it('with no stock there are no chips', async () => {
    serve({ [MARKET]: LATEST() })
    renderPanel()
    await screen.findByTestId('terminal-mna-deals')
    expect(screen.queryByTestId('terminal-mna-view-market')).toBeNull()
  })
})

describe('MNA follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['MergersPanel.jsx', 'mergersModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('MNA accessibility', () => {
  it('the deals, a refusal and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [MARKET]: LATEST() })
    const ok = renderPanel({}, { code: 'MNA' })
    await screen.findByTestId('terminal-mna-deals')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ [MARKET]: { status: 'unavailable', reason: 'not_in_plan' } })
    const locked = renderPanel()
    await screen.findByTestId('terminal-mna-unavailable')
    await expectNoAxeViolations(locked.container)
    cleanup()
    serve({})
    const failed = renderPanel()
    await screen.findByTestId('terminal-mna-error')
    await expectNoAxeViolations(failed.container)
  })
})
