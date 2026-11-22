// FUND: company metrics over time. Rails:
//   * loading, a failed catalog read (error with Retry), signed out, a plan without chart data (403), the
//     feature switched off for this server (404, said in words and never an empty panel), a timeout, an
//     answer that is not the catalog's shape, an empty library; no series read behind a failed catalog;
//   * the main company not held (404 after the catalog answered) and failing (Retry);
//   * the table: one column per fiscal quarter newest first, the default six rows in the catalog's own
//     format, the day each figure became public (hover text, screen-reader text, "Show dates"), a figure
//     the filing does not give in words, P/E from the stored weekly close, the newest 12 then all;
//   * compare: calendar quarters, the fiscal-year note, a series a company lacks, a company not held, a
//     split history not verified; the line, one company and compared; prices that failed;
//   * every choice written back into the panel's own command (and kept in the panel outside the shell);
//   * axe; tokens only; one reader; the header gets the newest figure's public time.
// Every company, ticker and figure is invented (__fixtures__/fundMetricsFixture.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import FundMetricsPanel, { FUND_CATALOG_URL, FUND_CODE, FUND_SOURCE } from './FundMetricsPanel'
import { COMPANIES, FUND_NOW_MS, PENDING, closeOn, fundRouter, morningOf } from './__fixtures__/fundMetricsFixture'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const serve = (over = {}) => jsonFetcher.mockImplementation(fundRouter(over))
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]
const HERE = path.dirname(fileURLToPath(import.meta.url))

function renderPanel(props = { sym: 'ZQXA' }, { setFreshness = vi.fn(), rerun = vi.fn(), inShell = true } = {}) {
  const body = <FundMetricsPanel {...props} />
  const list = { open: vi.fn(), run: vi.fn(), rerun: inShell ? rerun : undefined, publish: vi.fn(), publishRows: vi.fn() }
  const view = render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <PanelFreshnessContext.Provider value={setFreshness}>
          <PanelListContext.Provider value={list}>
            {inShell ? <TerminalPanelContext.Provider value={{ code: 'FUND', density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
          </PanelListContext.Provider>
        </PanelFreshnessContext.Provider>
      </SWRConfig>
    </MemoryRouter>,
  )
  return { setFreshness, rerun, container: view.container }
}
const root = () => screen.getByTestId('terminal-fund')
const row = (word, sym = 'ZQXA') => screen.getByTestId(`terminal-fund-row-${word}-${sym}`)
const cells = (word, sym) => within(row(word, sym)).queryAllByRole('cell')

beforeEach(() => { jsonFetcher.mockReset(); vi.spyOn(Date, 'now').mockReturnValue(FUND_NOW_MS) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('FUND states', () => {
  it('needs a ticker', () => {
    renderPanel({})
    expect(FUND_CODE).toBe('FUND')
    expect(screen.getByTestId('terminal-fund-input').textContent).toContain('FUND needs a ticker.')
    expect(jsonFetcher).not.toHaveBeenCalled()
  })

  it('shows a loading skeleton and asks the catalog first; the series wait for it', () => {
    serve({ catalog: PENDING })
    renderPanel()
    expect(screen.getByTestId('terminal-fund-loading')).toBeTruthy()
    expect(root().getAttribute('data-state')).toBe('loading')
    expect(asked()).toEqual([FUND_CATALOG_URL])
  })

  it('a failed catalog read is an error with Retry, and Retry reads again', async () => {
    serve({ catalog: fail(500) })
    const { setFreshness } = renderPanel()
    const err = await screen.findByTestId('terminal-fund-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('Company metrics from SEC filings could not be read just now.')
    expect(err.textContent).toContain('Retry, or run ZQXA FUND again.')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)
    serve()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-fund-table')).toBeTruthy()
  })

  it('signed out, a timeout, a plan without chart data and the feature switched off each say so; only an error can be retried', async () => {
    for (const [err, kind, state, words] of [
      [fail(401), 'error', 'signed_out', 'You are signed out, so company metrics from SEC filings cannot be read. Sign in again.'],
      [fail(0, { timedOut: true }), 'error', 'timeout', 'Company metrics from SEC filings did not answer within 30 seconds.'],
      [fail(403), 'locked', 'plan', 'Company metrics from SEC filings need a paid plan, the same one as chart data.'],
      [fail(404), 'locked', 'off', 'Company metrics from SEC filings are switched off for this server.'],
    ]) {
      serve({ catalog: err })
      renderPanel()
      const st = await screen.findByTestId('terminal-fund-error')
      expect(st.getAttribute('data-kind')).toBe(kind)
      expect(root().getAttribute('data-state')).toBe(state)
      expect(st.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' })).toBe(kind === 'error')
      expect(asked()).toEqual([FUND_CATALOG_URL])                  // no series read behind a failed catalog
      cleanup()
      jsonFetcher.mockReset()
    }
  })

  it('the feature switched off is said in words, never drawn as an empty table', async () => {
    serve({ catalog: fail(404) })
    renderPanel()
    const st = await screen.findByTestId('terminal-fund-error')
    expect(st.textContent).toContain('Nothing is wrong with your account.')
    expect(screen.queryByTestId('terminal-fund-table')).toBeNull()
    expect(screen.queryAllByRole('row')).toHaveLength(0)
  })

  it('an answer that is not the catalog\'s shape is a failed read with Retry; an empty library is said', async () => {
    serve({ catalog: { detail: 'not this' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-fund-error')).textContent).toContain('could not be read just now')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    cleanup()
    serve({ catalog: { version: 1, categories: [], metrics: [] } })
    renderPanel()
    expect((await screen.findByTestId('terminal-fund-empty')).textContent).toContain('The metrics library on this server has nothing this panel can show.')
  })

  it('a company the server does not hold says so after the catalog answered (a 404 here is the symbol), and asks no prices', async () => {
    serve()
    renderPanel({ sym: 'ZQXD' })
    const st = await screen.findByTestId('terminal-fund-not-held')
    expect(st.textContent).toContain('No figures from SEC filings are held for ZQXD here.')
    expect(st.textContent).toContain('funds and companies that file abroad (20-F, 40-F)')
    expect(root().getAttribute('data-state')).toBe('not_held')
    expect(asked().some((u) => u.startsWith('/api/bars/'))).toBe(false)
  })

  it('the company\'s read failing is an error with Retry, not "no figures"', async () => {
    serve({ series: { ZQXA: fail(500) } })
    renderPanel()
    const st = await screen.findByTestId('terminal-fund-error')
    expect(st.textContent).toContain("ZQXA's figures could not be read just now.")
    expect(st.textContent).toContain('That is not the same as no figures.')
    serve()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-fund-table')).toBeTruthy()
  })
})

describe('FUND table', () => {
  it('one column per fiscal quarter, newest first; the default six rows in the catalog\'s own format', async () => {
    serve()
    const { setFreshness } = renderPanel()
    const table = await screen.findByTestId('terminal-fund-table')
    expect(table.getAttribute('aria-label')).toBe('Metrics of ZQXA by fiscal quarter, newest first')
    const heads = screen.getAllByTestId('terminal-fund-quarter')
    expect(heads).toHaveLength(12)                                 // the newest 12 of 14
    expect(heads[0].textContent).toBe('Oct 252026')
    expect(heads[0].getAttribute('title')).toBe('Fiscal quarter ended Oct 25, 2026')
    expect(['REV', 'EPS', 'REVG', 'NETM', 'FCFM', 'PE'].map((w) => !!screen.queryByTestId(`terminal-fund-metric-${w}`))).toEqual([true, true, true, true, true, true])
    expect(row('REV').querySelector('th').textContent).toBe('Revenue (TTM)US dollars')
    const rev = cells('REV')
    expect(rev).toHaveLength(12)
    expect(rev[0].getAttribute('title')).toBe('$92.00B, quarter ended Oct 25, 2026, public Nov 18, 2026.')
    expect(within(rev[0]).getByText('$92.00B')).toBeTruthy()
    expect(rev[1].getAttribute('title')).toContain('A later filing revised it; first made public Aug 19, 2026 as $88.00B.')
    expect(rev[1].querySelector('sup').textContent).toBe('r')
    expect(screen.getByTestId('terminal-fund-revised').textContent).toContain('r: a later filing revised the figure')
    expect(cells('NETM')[0].textContent).toContain('33.0%')
    expect(cells('EPS')[0].textContent).toContain('$12.14')
    // a figure the filing does not give is words, never 0
    expect(cells('FCFM')[0].getAttribute('data-state')).toBe('gap')
    expect(cells('FCFM')[0].textContent).toContain('Not derivable')
    // P/E from the stored weekly close of the filing's week over the EPS TTM known then
    const pe = (closeOn('ZQXA', '2026-11-20') / COMPANIES.ZQXA.rows[13].eps_diluted_ttm).toFixed(2)
    expect(cells('PE')[0].textContent).toContain(`${pe}x`)
    expect(cells('PE')[0].getAttribute('title')).toContain('at the weekly close of Nov 20, 2026')
    expect(asked()).toContain('/api/bars/ZQXA?tf=W&bars=600')
    // the header: the newest figure's public time, from SEC filings
    const report = setFreshness.mock.calls.map(([r]) => r).filter(Boolean).at(-1)
    expect(report.source).toBe(FUND_SOURCE)
    expect(report.observedAt).toBe(new Date(morningOf('2026-11-18') * 1000).toISOString())
    expect(screen.getByTestId('terminal-fund-head').textContent).toContain('NORTHWIND SILICON CORP')
    expect(screen.getByTestId('terminal-fund-head').textContent).toContain('Newest figure public Nov 18, 2026.')
  })

  it('each figure says when its filing became public: to a screen reader always, on screen with "Show dates"', async () => {
    serve()
    renderPanel()
    await screen.findByTestId('terminal-fund-table')
    const first = cells('REV')[0]
    expect(first.querySelector('.sr-only').textContent).toBe('$92.00B, quarter ended Oct 25, 2026, public Nov 18, 2026.')
    expect([...first.children].map((c) => c.textContent)).toEqual(['$92.00B', '$92.00B, quarter ended Oct 25, 2026, public Nov 18, 2026.'])
    fireEvent.click(screen.getByTestId('terminal-fund-dates'))
    expect(screen.getByTestId('terminal-fund-dates').getAttribute('aria-pressed')).toBe('true')
    expect([...cells('REV')[0].children].map((c) => c.textContent).at(-1)).toBe('Nov 18')
  })

  it('the newest 12 quarters, then all of them', async () => {
    serve()
    renderPanel()
    await screen.findByTestId('terminal-fund-table')
    expect(screen.getByTestId('terminal-fund-cut').textContent).toContain('The newest 12 of 14 quarters.')
    fireEvent.click(screen.getByTestId('terminal-fund-all'))
    expect(screen.getAllByTestId('terminal-fund-quarter')).toHaveLength(14)
    expect(cells('REVG').at(-1).textContent).toContain('Not reported')   // the first quarters have no growth figure yet
    fireEvent.click(screen.getByTestId('terminal-fund-all'))
    expect(screen.getAllByTestId('terminal-fund-quarter')).toHaveLength(12)
  })

  it('the source line, the valuation note, the filing lag and how each figure is worked out', async () => {
    serve()
    renderPanel()
    await screen.findByTestId('terminal-fund-table')
    expect(screen.getByTestId('terminal-fund-source').textContent)
      .toBe("Source: SEC filings (XBRL), as filed; each value dated by when its filing became public. Valuation uses UCT's stored prices.")
    expect(screen.getByTestId('terminal-fund-valuation').textContent).toMatch(/^P\/E \(TTM\) is not filed: UCT works it out from its stored weekly close/)
    expect(screen.getByTestId('terminal-fund-lag').textContent).toBe('Updates when the 10-Q/10-K is filed, which can follow the earnings press release by days; press-release figures are not machine-readable.')
    const method = screen.getByTestId('terminal-fund-method')
    expect(method.textContent).toContain('Revenue (TTM) (US dollars)')
    expect(method.textContent).toContain('TTM = the reported fiscal-year value at year-end')
    expect(method.textContent).toContain('P/E (TTM) (times)')
  })
})

describe('FUND compare', () => {
  it('calendar quarters, the note on fiscal years, a series one company lacks, a company not held', async () => {
    serve()
    renderPanel({ sym: 'ZQXA', peers: ['ZQXB', 'ZQXD'] })
    const table = await screen.findByTestId('terminal-fund-table')
    expect(table.getAttribute('aria-label')).toBe('Metrics of ZQXA, ZQXB, ZQXD by calendar quarter, newest first')
    expect(screen.getAllByTestId('terminal-fund-quarter')[0].textContent).toBe('Jul-Sep2026')
    expect(screen.getByTestId('terminal-fund-align').textContent).toContain("Fiscal years differ: ZQXA's ends in January, ZQXB's ends in December.")
    expect(screen.getByTestId('terminal-fund-align').textContent).toContain('up to 4 weeks apart')
    expect(cells('REV', 'ZQXA')[0].getAttribute('title')).toContain('quarter ended Oct 25, 2026')
    expect(cells('REV', 'ZQXB')[0].getAttribute('title')).toContain('quarter ended Sep 30, 2026')
    expect(row('FCFM', 'ZQXB').textContent).toContain('Not reported in its filings.')
    expect(row('REV', 'ZQXD').textContent).toContain('No figures held for ZQXD.')
    expect(screen.getByTestId('terminal-fund-peer-note').textContent).toContain('No figures from SEC filings are held for ZQXD here.')
    // the metric heads its rows; each company's row is a ticker that loads the linked panels
    expect(within(screen.getByTestId('terminal-fund-metric-REV')).getByText('Revenue (TTM)').closest('th').getAttribute('scope')).toBe('rowgroup')
    expect(within(row('REV', 'ZQXB')).getByTestId('panel-symbol-ZQXB')).toBeTruthy()
    // a negative EPS is "n/m", never a negative P/E
    fireEvent.click(screen.getByTestId('terminal-fund-all'))
    expect(cells('PE', 'ZQXB').at(-2).textContent).toContain('n/m')     // its first quarter (Jul-Sep 2023), a loss
    expect(cells('PE', 'ZQXB').at(-1).textContent).toContain('No filing')   // it has no Apr-Jun 2023 quarter
  })

  it('a split history not verified withholds the per-share rows, in words', async () => {
    serve()
    renderPanel({ sym: 'ZQXC' })
    await screen.findByTestId('terminal-fund-table')
    expect(screen.getByTestId('terminal-fund-withheld').textContent).toContain("ZQXC's split history could not be verified")
    expect(row('EPS', 'ZQXC').textContent).toContain('Withheld for ZQXC')
    expect(row('PE', 'ZQXC').textContent).toContain('Withheld for ZQXC')
    expect(cells('REV', 'ZQXC')[0].textContent).toContain('$4.50B')
  })

  it('prices that cannot be read leave the filed rows and say so, with Retry', async () => {
    serve({ bars: { ZQXA: fail(500) } })
    renderPanel()
    await screen.findByTestId('terminal-fund-table')
    expect(await screen.findByTestId('terminal-fund-prices-note')).toBeTruthy()
    expect(row('PE').textContent).toContain("UCT's stored prices for ZQXA could not be read just now.")
    expect(cells('REV')[0].textContent).toContain('$92.00B')
    serve()
    fireEvent.click(screen.getByRole('button', { name: 'Retry prices' }))
    expect(await screen.findByText(/at the weekly close of Nov 20, 2026/)).toBeTruthy()
  })
})

describe('FUND line', () => {
  it('one metric over every quarter held, in words', async () => {
    serve()
    renderPanel({ sym: 'ZQXA', line: 'revenue_ttm' })
    const fig = await screen.findByTestId('terminal-fund-line')
    expect(fig.querySelector('svg').getAttribute('role')).toBe('img')
    expect(fig.querySelectorAll('path')).toHaveLength(1)
    expect(fig.textContent).toContain('Revenue (TTM), 14 quarters')
    expect(screen.getAllByTestId('terminal-fund-line-sentence')[0].textContent)
      .toBe('ZQXA: low $40.00B (Jul 30, 2023), high $92.00B (Oct 25, 2026), newest $92.00B (Oct 25, 2026).')
    expect(screen.queryByTestId('terminal-fund-table')).toBeNull()
    expect(screen.getByTestId('terminal-fund-line-metric').value).toBe('revenue_ttm')
  })

  it('compared: one line per company on one range, a legend of tickers', async () => {
    serve()
    renderPanel({ sym: 'ZQXA', peers: ['ZQXB'], line: 'revenue_ttm' })
    const fig = await screen.findByTestId('terminal-fund-line')
    expect([...fig.querySelectorAll('svg[role="img"] path')].map((p) => p.getAttribute('data-sym'))).toEqual(['ZQXA', 'ZQXB'])
    const legend = screen.getByTestId('terminal-fund-legend')
    expect(within(legend).getByTestId('panel-symbol-ZQXB')).toBeTruthy()
    expect(legend.textContent).toContain('$16.00B')
  })
})

describe('FUND choices are kept by the board', () => {
  it('the view, the line\'s metric, the rows and the compared tickers write themselves into the command', async () => {
    serve()
    const { rerun } = renderPanel({ sym: 'ZQXA', peers: ['ZQXB'] })
    await screen.findByTestId('terminal-fund-table')
    fireEvent.click(screen.getByTestId('terminal-fund-view-line'))
    expect(rerun).toHaveBeenLastCalledWith('ZQXA FUND ZQXB REV')
    fireEvent.change(screen.getByTestId('terminal-fund-line-metric'), { target: { value: 'pe_ttm' } })
    expect(rerun).toHaveBeenLastCalledWith('ZQXA FUND ZQXB PE')
    fireEvent.click(screen.getByTestId('terminal-fund-view-table'))
    expect(rerun).toHaveBeenLastCalledWith('ZQXA FUND ZQXB')
    fireEvent.click(screen.getByRole('button', { name: 'Stop comparing ZQXB' }))
    expect(rerun).toHaveBeenLastCalledWith('ZQXA FUND')
    fireEvent.change(screen.getByTestId('terminal-fund-add-input'), { target: { value: 'zqxc' } })
    fireEvent.submit(screen.getByTestId('terminal-fund-add-input').closest('form'))
    expect(rerun).toHaveBeenLastCalledWith('ZQXA FUND ZQXC')
  })

  it('the picker: the catalog\'s categories, up to twelve, applied as one + set; cancel changes nothing', async () => {
    serve()
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-fund-table')
    const open = screen.getByTestId('terminal-fund-metrics')
    expect(open.textContent).toBe('Metrics: 6 of 29')
    fireEvent.click(open)
    expect(open.getAttribute('aria-expanded')).toBe('true')
    const picker = screen.getByTestId('terminal-fund-picker')
    expect(within(picker).getAllByRole('group').map((g) => g.querySelector('legend').textContent))
      .toEqual(['Financials', 'Growth', 'Profitability', 'Valuation', 'Financial Health', 'Shares & Dividends', 'Market'])
    expect(screen.getByTestId('terminal-fund-pick-REV').textContent).toBe('Revenue (TTM)US dollars')
    expect(screen.getByTestId('terminal-fund-pick-PE').textContent).toBe('P/E (TTM)times, Trailing')
    fireEvent.click(within(screen.getByTestId('terminal-fund-pick-ROE')).getByRole('checkbox'))
    fireEvent.click(screen.getByTestId('terminal-fund-apply'))
    expect(rerun).toHaveBeenLastCalledWith('ZQXA FUND REV+EPS+REVG+NETM+FCFM+ROE+PE')
    expect(screen.queryByTestId('terminal-fund-picker')).toBeNull()
    fireEvent.click(open)
    fireEvent.click(within(screen.getByTestId('terminal-fund-pick-CASHEQ')).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(rerun).toHaveBeenCalledTimes(1)
    fireEvent.click(open)
    for (const w of ['REVQ', 'NETINC', 'NETINCQ', 'EPSQ', 'OCF', 'FREECF']) fireEvent.click(within(screen.getByTestId(`terminal-fund-pick-${w}`)).getByRole('checkbox'))
    expect(screen.getByTestId('terminal-fund-picker-count').textContent).toMatch(/^12 chosen\./)
    expect(within(screen.getByTestId('terminal-fund-pick-ROA')).getByRole('checkbox').disabled).toBe(true)
  })

  it('a ticker the box cannot take is said beside it', async () => {
    serve()
    const { rerun } = renderPanel()
    await screen.findByTestId('terminal-fund-table')
    const input = screen.getByTestId('terminal-fund-add-input')
    fireEvent.change(input, { target: { value: 'zqxa' } })
    fireEvent.submit(input.closest('form'))
    expect(screen.getByRole('alert').textContent).toBe('ZQXA is the main ticker already.')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(rerun).not.toHaveBeenCalled()
  })

  it('the main ticker typed again as a comparison is said, not compared with itself', async () => {
    serve()
    renderPanel({ sym: 'ZQXA', peers: ['ZQXA', 'ZQXB'] })
    await screen.findByTestId('terminal-fund-table')
    expect(screen.getByTestId('terminal-fund-self').textContent).toBe('ZQXA is the main ticker, so it is not compared with itself.')
    expect(screen.getAllByTestId('terminal-fund-peer').map((p) => p.textContent)).toEqual(['ZQXBRemove'])
  })

  it('outside the shell a choice stays in the panel', async () => {
    serve()
    renderPanel({ sym: 'ZQXA', peers: ['ZQXB'] }, { inShell: false })
    await screen.findByTestId('terminal-fund-table')
    fireEvent.click(screen.getByRole('button', { name: 'Stop comparing ZQXB' }))
    expect(screen.queryByTestId('terminal-fund-peer')).toBeNull()
    expect(screen.getByTestId('terminal-fund-table').getAttribute('aria-label')).toBe('Metrics of ZQXA by fiscal quarter, newest first')
  })
})

describe('FUND rails', () => {
  it('has no axe violations: the table, compared, the line, the picker, and a failed read', async () => {
    serve()
    const one = renderPanel()
    await screen.findByTestId('terminal-fund-table')
    fireEvent.click(screen.getByTestId('terminal-fund-metrics'))
    await expectNoAxeViolations(one.container)
    cleanup()
    serve()
    const two = renderPanel({ sym: 'ZQXA', peers: ['ZQXB', 'ZQXD'] })
    await screen.findByTestId('terminal-fund-table')
    await expectNoAxeViolations(two.container)
    cleanup()
    serve()
    const line = renderPanel({ sym: 'ZQXA', peers: ['ZQXB'], line: 'pe_ttm' })
    await screen.findByTestId('terminal-fund-line')
    await expectNoAxeViolations(line.container)
    cleanup()
    serve({ catalog: fail(404) })
    const off = renderPanel()
    await screen.findByTestId('terminal-fund-error')
    await expectNoAxeViolations(off.container)
  })

  it('paints no hard-coded colour and no price colour: the panel, its model and its stylesheet use tokens only', () => {
    for (const file of ['FundMetricsPanel.jsx', 'fundMetricsModel.js', 'fundMetricsPanel.module.css']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${file}`, src).map((h) => h.lit), file).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'fundMetricsPanel.module.css'), 'utf8')
    expect(css).not.toMatch(/--(success|danger|gain|loss|ut-gold|accent)/)   // no gold: it marks only what is chosen
    expect(css).not.toMatch(/@media|infinite|data-fit|cursor:/)
    // the table holds its cells' screen-reader words, so they scroll in its box and never widen the panel
    // (measured on a real screen: without it a 462px panel body scrolled to 949px)
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).toMatch(/\.periods \{\s*position: relative;\s*\}/)
    expect(css).toMatch(/\.periods th:first-child,\s*\.periods td:first-child \{\s*position: sticky;\s*left: 0;/)
  })

  it('reads through the terminal\'s one reader, never browser storage, and reports the data\'s own time to the header', () => {
    const src = fs.readFileSync(path.join(HERE, 'FundMetricsPanel.jsx'), 'utf8')
    expect(src).toMatch(/useMarketRead\(FUND_CATALOG_URL, POLL\)/)
    expect((src.match(/useMarketRead\(/g) || []).length).toBe(9)
    expect(src).toMatch(/usePanelFreshness\(ok && view \? panelAsOf\(FUND_SOURCE, view\.newestT\) : null\)/)
    expect(src).not.toMatch(/setInterval|setTimeout|fetch\(|localStorage|sessionStorage/)
    expect(process.env.NODE_ENV).not.toBe('production')
  })
})
