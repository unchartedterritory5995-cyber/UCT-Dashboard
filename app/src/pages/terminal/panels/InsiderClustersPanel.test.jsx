// INS CLUSTER: the cluster list from the SEC's Form 4 filings. Every company, person, ticker and number
// here is invented. Rails:
//   * `INS CLUSTER` draws the clusters newest first: the stock (a ticker through PanelSymbol, a filer with
//     no ticker as plain text), insiders and roles, the money and the average, the close and the change,
//     the first and last buy; a row opens to name each insider and link the newest filing;
//   * the header names the source and the held store's own as-of; the method line says the rule, the
//     night it was read and, when it is, that the read is incomplete or cut;
//   * not built yet, empty, a failed read (Retry), a 402 (paid plan), an answer it cannot read;
//   * the chip back to all buys writes `INS`; outside the shell it switches in place;
//   * bare INS is unchanged: it never asks for the clusters;
//   * no hard-coded colour; axe.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import InsiderPanel from './InsiderPanel'
import InsiderClustersPanel from './InsiderClustersPanel'
import { INS_CLUSTERS_URL } from './insiderClustersModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MARKET_URL = '/api/insider/feed?scope=market'

const QFRB = {
  issuer_cik: '0009900001', ticker: 'QFRB', company: 'Quillfeather Robotics Inc', insiders: 3,
  roles: { ceo: 1, cfo: 1, officer: 0, director: 1, ten_percent: 0, other: 0, not_stated: 0 },
  people: [
    { names: ['Anneliese Marrow-Quint'], role: 'ceo', last_buy: '2031-03-10', value: 12500 },
    { names: ['Bramwell Oduya'], role: 'cfo', last_buy: '2031-03-12', value: 4800 },
    { names: ['Coralind Vesh'], role: 'director', last_buy: '2031-03-13', value: 26000 },
  ],
  first_buy: '2031-03-10', last_buy: '2031-03-13', buys: 4, filings: 3, last_filed: '2031-03-14',
  shares: 3500, value: 43300, value_complete: false, unpriced_buys: 1, avg_price: 12.7353,
  close: { value: 13.75, date: '2031-03-14', reason: null }, change_pct: 7.97,
  url: 'https://www.sec.gov/Archives/edgar/data/9900001/000123456731000103/0001234567-31-000103-index.htm',
}
const KWZP = {
  issuer_cik: '0009900003', ticker: 'KWZP', company: 'Kestrelwick Holdings Inc', insiders: 5,
  roles: { director: 4, ten_percent: 1 }, people: [{ names: ['Dovrin Pell'], role: 'director', last_buy: '2031-03-07', value: 2100 }],
  first_buy: '2031-03-03', last_buy: '2031-03-07', buys: 6, filings: 5, value: 1250000, value_complete: true, avg_price: 6.25,
  close: { value: 5.5, date: '2031-03-14', reason: null }, change_pct: -12.0, url: null,
}
const VELLUM = {
  issuer_cik: '0009900002', ticker: null, company: 'Vellumark Biosystems Corp', insiders: 3, roles: { director: 3 }, people: [],
  first_buy: '2031-03-05', last_buy: '2031-03-05', buys: 3, filings: 3, value: 9000, value_complete: true, avg_price: 4.5,
  close: { value: null, date: null, reason: 'no_ticker' }, change_pct: null, url: null,
}
const OK = {
  status: 'ok', as_of: '2031-03-14', read_at: '2031-03-15T05:23:00+00:00', source: 'SEC Form 4 filings (open-market purchases)',
  rules: { min_insiders: 3, window_business_days: 10 }, clusters: [QFRB, KWZP, VELLUM], total: 3, truncated: false, cut_from: null,
  coverage: { complete: true, listed: 6400, read: 6400, given_up: 0, from: '2031-02-27', to: '2031-03-14', window_weekdays: 12 },
  last_run: { stop: null }, building: false, next_run: '2031-03-18T01:20-04:00',
}

const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    const hit = routes[url]
    if (hit === undefined) return Promise.reject(fail(500))
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([url]) => url))]

function renderPanel(el, { code = null, rerun = vi.fn(), run = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{el}</TerminalPanelContext.Provider> : el}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { rerun, run, publishRows, setFreshness }
}
const rowIds = () => within(screen.getByTestId('terminal-insider-cluster-table')).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-insider-cluster-row-', ''))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('INS CLUSTER', () => {
  it('draws the clusters newest first with every field, and a ticker loads into the linked panels', async () => {
    serve({ [INS_CLUSTERS_URL]: OK })
    const { run, publishRows, setFreshness } = renderPanel(<InsiderPanel view="cluster" />, { code: 'INS' })
    await screen.findByTestId('terminal-insider-cluster-table')
    expect(asked()).toEqual([INS_CLUSTERS_URL])
    expect(rowIds()).toEqual(['QFRB', 'KWZP', '2'])
    const headers = within(screen.getByTestId('terminal-insider-cluster-table')).getAllByRole('columnheader').map((h) => h.textContent.trim().split(/\s/)[0])
    expect(headers).toEqual(['Stock', 'Insiders', 'Bought', 'Since', 'Last'])
    const q = screen.getByTestId('terminal-insider-cluster-row-QFRB').textContent
    for (const s of ['QFRB', 'Quillfeather Robotics Inc', '3 insiders', 'CEO, CFO, director', 'at least $43K', 'avg $12.74',
      '+7.97%', '$13.75 Mar 14', 'Mar 13', 'from Mar 10']) expect(q, s).toContain(s)   // the close's month and day never part
    const k = screen.getByTestId('terminal-insider-cluster-row-KWZP').textContent
    for (const s of ['5 insiders', '4 directors, 10% owner', '$1.3M', '-12.00%', 'Mar 7', 'from Mar 3']) expect(k, s).toContain(s)
    // a filer that gave no ticker: plain text, never a link, and its close says why
    const v = screen.getByTestId('terminal-insider-cluster-row-2')
    expect(within(v).queryByRole('button', { name: /VLMQ/ })).toBeNull()
    expect(v.textContent).toContain('No ticker')
    expect(v.textContent).toContain('Vellumark Biosystems Corp')
    expect(v.textContent).toContain('no ticker in the filing')
    expect(v.textContent).not.toContain('from')                      // one buy day: no "from"
    fireEvent.click(screen.getByTestId('panel-symbol-KWZP'))
    expect(run).toHaveBeenCalledWith('$KWZP')
    expect(publishRows).toHaveBeenLastCalledWith(['$QFRB', '$KWZP'])
    // the header: the source in words and the held store's own as-of
    const report = setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()
    expect(report.source).toBe('SEC Form 4 filings (open-market purchases)')
    expect(report.age.asOfDate).toBe('2031-03-14')
    const method = screen.getByTestId('terminal-insider-cluster-method').textContent
    expect(method).toContain('Stocks where 3 or more insiders bought shares on the open market within 10 business days')
    expect(method).toContain('Filings through Mar 14, read Sat Mar 15, 1:23 AM ET.')
    expect(method).toContain('Source: SEC Form 4 filings (open-market purchases).')
    expect(screen.queryByTestId('terminal-insider-cluster-cut')).toBeNull()
  })

  it('a row opens to name each insider and link the newest filing, and closes again', async () => {
    serve({ [INS_CLUSTERS_URL]: OK })
    renderPanel(<InsiderClustersPanel />)
    await screen.findByTestId('terminal-insider-cluster-table')
    const toggle = screen.getByTestId('terminal-insider-cluster-open-QFRB')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('terminal-insider-cluster-people-QFRB')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const people = screen.getByTestId('terminal-insider-cluster-people-QFRB')
    expect(within(people).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Anneliese Marrow-Quint, CEO: $13K, last buy Mar 10',
      'Bramwell Oduya, CFO: $5K, last buy Mar 12',
      'Coralind Vesh, director: $26K, last buy Mar 13',
    ])
    expect(within(people).getByRole('link', { name: 'The newest filing on sec.gov' }).getAttribute('href')).toBe(QFRB.url)
    expect(toggle.getAttribute('aria-controls')).toBe(people.querySelector('td').id)
    fireEvent.click(toggle)
    expect(screen.queryByTestId('terminal-insider-cluster-people-QFRB')).toBeNull()
  })

  it('sorts by a column and says which way', async () => {
    serve({ [INS_CLUSTERS_URL]: OK })
    renderPanel(<InsiderClustersPanel />)
    await screen.findByTestId('terminal-insider-cluster-table')
    fireEvent.click(screen.getByTestId('terminal-insider-cluster-sort-insiders'))
    expect(rowIds()).toEqual(['KWZP', 'QFRB', '2'])
    expect(screen.getByTestId('terminal-insider-cluster-sort-insiders').closest('th').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByTestId('terminal-insider-cluster-sort-value'))
    expect(rowIds()[0]).toBe('KWZP')
  })

  it('says when the read is incomplete or the list was cut, and from which end', async () => {
    serve({ [INS_CLUSTERS_URL]: { ...OK, truncated: true, total: 71, cut_from: 'oldest',
      coverage: { ...OK.coverage, complete: false, read: 4100 }, last_run: { stop: 'cap' } } })
    renderPanel(<InsiderClustersPanel />)
    await screen.findByTestId('terminal-insider-cluster-table')
    expect(screen.getByTestId('terminal-insider-cluster-cut').textContent).toBe('Showing the newest 3 of 71 clusters; the older ones are left off.')
    expect(screen.getByTestId('terminal-insider-cluster-method').textContent)
      .toContain('4,100 of 6,400 Form 4 filings of the last 12 weekdays are read so far; the rest are read on the coming nights.')
  })

  it('a list not built yet says whether its first read is running, or when it is due', async () => {
    serve({ [INS_CLUSTERS_URL]: { status: 'not_built', building: false, next_run: '2031-03-18T01:20-04:00' } })
    const { setFreshness } = renderPanel(<InsiderClustersPanel />)
    const box = await screen.findByTestId('terminal-insider-cluster-not-built')
    expect(box.textContent).toContain('The cluster list has not been built yet.')
    expect(box.textContent).toContain('is due Tue Mar 18, 1:20 AM ET')
    expect(box.textContent).toContain('nothing is built when you open the panel')
    expect(setFreshness.mock.calls.every(([r]) => r == null)).toBe(true)   // no as-of for a list that does not exist
    cleanup()
    serve({ [INS_CLUSTERS_URL]: { status: 'not_built', building: true, next_run: '2031-03-18T01:20-04:00' } })
    renderPanel(<InsiderClustersPanel />)
    expect((await screen.findByTestId('terminal-insider-cluster-not-built')).textContent).toContain('is running now')
  })

  it('an empty list is an answer, with the rule and the read', async () => {
    serve({ [INS_CLUSTERS_URL]: { ...OK, clusters: [], total: 0 } })
    renderPanel(<InsiderClustersPanel />)
    expect((await screen.findByTestId('terminal-insider-cluster-empty')).textContent).toContain('No insider cluster buys in the filings held.')
    expect(screen.getByTestId('terminal-insider-cluster-method').textContent).toContain('Filings through Mar 14')
  })

  it('a failed read is an error with Retry; a 402 says paid plan; an answer it cannot read says so', async () => {
    serve({ [INS_CLUSTERS_URL]: fail(500) })
    renderPanel(<InsiderClustersPanel />)
    expect((await screen.findByTestId('terminal-insider-cluster-error')).textContent).toContain('could not be read just now')
    expect(screen.getByTestId('terminal-insider-cluster-error').textContent).toContain('not the same as no cluster buying')
    serve({ [INS_CLUSTERS_URL]: OK })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-insider-cluster-table')).toBeTruthy()
    cleanup()
    serve({ [INS_CLUSTERS_URL]: fail(402) })
    renderPanel(<InsiderClustersPanel />)
    const locked = await screen.findByTestId('terminal-insider-cluster-error')
    expect(locked.textContent).toContain('Insider cluster buys needs a paid plan.')
    expect(within(locked).queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    serve({ [INS_CLUSTERS_URL]: { status: 'something else' } })
    renderPanel(<InsiderClustersPanel />)
    expect((await screen.findByTestId('terminal-insider-cluster-error')).textContent).toContain('shape this panel cannot read')
  })

  it('the chip back to all buys writes INS into the command line; outside the shell it switches in place', async () => {
    serve({ [INS_CLUSTERS_URL]: OK, [MARKET_URL]: [] })
    const { rerun } = renderPanel(<InsiderPanel view="cluster" />, { code: 'INS' })
    await screen.findByTestId('terminal-insider-cluster-table')
    expect(screen.getByTestId('terminal-insider-cluster-view-cluster').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-insider-cluster-view-buys'))
    expect(rerun).toHaveBeenCalledWith('INS')
    cleanup()
    serve({ [INS_CLUSTERS_URL]: OK, [MARKET_URL]: [] })
    renderPanel(<InsiderPanel view="cluster" />)
    await screen.findByTestId('terminal-insider-cluster-table')
    fireEvent.click(screen.getByTestId('terminal-insider-cluster-view-buys'))
    expect(await screen.findByTestId('terminal-insider-empty')).toBeTruthy()
    expect(asked()).toContain(MARKET_URL)
  })

  it('bare INS is the market-wide buys, exactly as before: it never asks for the clusters', async () => {
    serve({ [MARKET_URL]: [], [INS_CLUSTERS_URL]: OK })
    renderPanel(<InsiderPanel />, { code: 'INS' })
    await screen.findByTestId('terminal-insider-empty')
    expect(asked()).toEqual([MARKET_URL])
    expect(screen.queryByTestId('terminal-insider-cluster-view-buys')).toBeNull()
  })
})

describe('INS CLUSTER follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded colour', () => {
    for (const f of ['InsiderClustersPanel.jsx', 'insiderClustersModel.js', 'InsiderPanel.jsx']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('INS CLUSTER accessibility', () => {
  it('the list with a row open, not built, and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [INS_CLUSTERS_URL]: OK })
    renderPanel(<InsiderClustersPanel />, { code: 'INS' })
    await screen.findByTestId('terminal-insider-cluster-table')
    fireEvent.click(screen.getByTestId('terminal-insider-cluster-open-QFRB'))
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [INS_CLUSTERS_URL]: { status: 'not_built', building: false, next_run: '2031-03-18T01:20-04:00' } })
    renderPanel(<InsiderClustersPanel />)
    await screen.findByTestId('terminal-insider-cluster-not-built')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({})
    renderPanel(<InsiderClustersPanel />)
    await screen.findByTestId('terminal-insider-cluster-error')
    await expectNoAxeViolations(document.body.firstElementChild)
  })
})
