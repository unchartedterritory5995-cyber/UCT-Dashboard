// COV-05 People / COV-07 Estimate history / COV-09 Filings feed — asserted on
// rendered TEXT. Payload shapes are the backend's own (api/services/research_people.py,
// estimate_history.py, filings_feed.py), with names and figures taken from the
// recorded fixtures in tests/fixtures/research_cov/.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import PeopleTab from './PeopleTab'
import EstimateHistoryTab from './EstimateHistoryTab'
import FilingsFeedTab from './FilingsFeedTab'

let routes
let status
beforeEach(() => {
  status = 200
  routes = {}
  global.fetch = vi.fn((url) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k))
    const body = key ? routes[key] : {}
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const wrap = (el) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{el}</SWRConfig>,
)

const EXECS_SRC = 'FMP /stable/key-executives'
const PEOPLE = {
  ticker: 'AAPL',
  executives: {
    state: 'ok', source: EXECS_SRC, as_of: '2026-10-02',
    rows: [
      { name: 'Timothy D. Cook', title: 'Chief Executive Officer & Director', since: null, pay: 16759518,
        pay_currency: 'USD', pay_note: 'year not stated by FMP', unavailable: { since: 'FMP does not report when this officer took the title' },
        comp_total: 74294811, comp_year: 2025, insider_role: 'Chief Executive Officer', source: EXECS_SRC, as_of: '2026-10-02' },
      { name: 'Adrian Perica', title: 'Vice President of Corporate Development', since: null, pay: null,
        unavailable: { since: 'FMP does not report when this officer took the title', pay: 'FMP reports no pay figure for this officer' },
        comp_total: null, insider_role: null, source: EXECS_SRC, as_of: '2026-10-02' },
    ],
  },
  compensation: {
    state: 'ok', source: 'FMP /stable/governance-executive-compensation (proxy summary compensation table)', as_of: '2026-10-02', year: 2025,
    rows: [{ name_and_position: 'Tim Cook Chief Executive Officer', year: 2025, salary: 3000000, stock_award: 57534997,
      incentive: 12000000, total: 74294811, filing_date: '2026-01-08',
      url: 'https://www.sec.gov/Archives/edgar/data/320193/000130817926000008/0001308179-26-000008-index.htm' }],
  },
  insider_roles: { state: 'unavailable', source: 'SEC EDGAR Form 4', window_days: 180, rows: null,
    reason: 'EDGAR Form 4 reading is switched off on this server (EDGAR_OWNERSHIP_ENABLED)' },
}

describe('PeopleTab (COV-05)', () => {
  it('names the source and date, and shows unknowns as "unavailable", never blank', async () => {
    routes['/api/research/people/AAPL'] = PEOPLE
    wrap(<PeopleTab sym="aapl" />)
    expect((await screen.findByTestId('people-execs-source')).textContent).toContain(`Source: ${EXECS_SRC}, read 2026-10-02`)
    const perica = screen.getByTestId('exec-Adrian Perica').textContent
    expect(perica).toContain('unavailable')
    expect(perica).toContain('not in proxy table')
    expect(screen.getByTestId('exec-Timothy D. Cook').textContent).toContain('$74.29M (2025)')
  })

  it('every compensation row links to its SEC filing', async () => {
    routes['/api/research/people/AAPL'] = PEOPLE
    wrap(<PeopleTab sym="AAPL" />)
    await screen.findByTestId('people-comp')
    const link = screen.getByRole('link', { name: '2026-01-08' })
    expect(link.getAttribute('href')).toMatch(/^https:\/\/www\.sec\.gov\//)
  })

  it('a section that could not be read gives its reason, not an empty table', async () => {
    routes['/api/research/people/AAPL'] = PEOPLE
    wrap(<PeopleTab sym="AAPL" />)
    expect((await screen.findByTestId('people-roles-gap')).textContent).toMatch(/Unavailable: EDGAR Form 4 reading is switched off/)
  })

  it('a failed request is unavailable, not a finding', async () => {
    status = 503
    wrap(<PeopleTab sym="AAPL" />)
    expect((await screen.findByTestId('people-unavailable')).textContent).toMatch(/not a finding about AAPL/)
  })
})

const SRC = 'FMP /stable/analyst-estimates (period=quarter), snapshotted daily by UCT'
const pt = (d, e, r) => ({ snap_date: d, eps_avg: e, eps_low: e - 0.1, eps_high: e + 0.1, rev_avg: r, n_eps: 30, n_rev: 28, source: SRC })

describe('EstimateHistoryTab (COV-07)', () => {
  it('states where history begins and renders a revision only at n >= 2', async () => {
    routes['/api/research/estimate-history/AAPL'] = {
      ticker: 'AAPL', source: SRC, state: 'ok', covers_from: '2026-10-01', last_snapshot: '2026-10-02', snapshot_days: 2,
      failed_days: [{ snap_date: '2026-09-30', status: 'error', detail: 'x' }],
      periods: [
        { period_end: '2026-12-27', n: 2, first_snapshot: '2026-10-01', state: 'revisions',
          eps_change: { abs: 0.18, pct: 10 }, rev_change: { abs: 0, pct: 0 },
          points: [pt('2026-10-01', 1.8, 1.2e11), pt('2026-10-02', 1.98, 1.2e11)] },
        { period_end: '2027-03-27', n: 1, first_snapshot: '2026-10-02', state: 'collecting',
          reason: 'one snapshot so far (2026-10-02); a revision needs two', points: [pt('2026-10-02', 1.6, 1.0e11)] },
      ],
    }
    wrap(<EstimateHistoryTab sym="AAPL" />)
    expect((await screen.findByTestId('esthist-window')).textContent).toContain('History before 2026-10-01 was not recorded')
    expect(screen.getByTestId('revision-2026-12-27').textContent).toContain('EPS +10.00%')
    expect(screen.getByTestId('collecting-2027-03-27').textContent).toMatch(/a revision needs two/)
    expect(screen.queryByTestId('revision-2027-03-27')).toBeNull()
    expect(screen.getByTestId('esthist-failed').textContent).toContain('2026-09-30')
    expect(screen.getByTestId('esthist-source').textContent).toContain(SRC)
  })

  it('no snapshot yet says why, never an empty table', async () => {
    routes['/api/research/estimate-history/AAPL'] = {
      ticker: 'AAPL', source: SRC, state: 'collecting', covers_from: null, snapshot_days: 0, periods: [], failed_days: [],
      reason: 'no snapshot yet: the daily job adds one each evening, and history begins with the first',
    }
    wrap(<EstimateHistoryTab sym="AAPL" />)
    expect((await screen.findByTestId('esthist-window')).textContent).toMatch(/no snapshot yet/)
  })
})

const ROW_8K = {
  form: '8-K', company: 'Apple Inc.', cik: 320193, ticker: 'AAPL', accession: '0001140361-26-033120',
  filed: '2026-08-21', accepted: '2026-08-21T16:30:12.000Z', source: 'SEC EDGAR submissions',
  url: 'https://www.sec.gov/Archives/edgar/data/320193/000114036126033120/0001140361-26-033120-index.htm',
  items: [{ code: '5.02', label: 'Departure / Election of Directors or Officers; Compensatory Arrangements' }],
}

describe('FilingsFeedTab (COV-09)', () => {
  it('each row cites its accession, links to SEC, and shows 8-K item codes', async () => {
    routes['/api/research/filings-feed/AAPL'] = { state: 'ok', ticker: 'AAPL', source: 'SEC EDGAR submissions', rows: [ROW_8K], merged_from_feed: 0 }
    wrap(<FilingsFeedTab sym="AAPL" />)
    const link = await screen.findByRole('link', { name: '0001140361-26-033120' })
    expect(link.getAttribute('href')).toBe(ROW_8K.url)
    expect(screen.getByTestId('filing-0001140361-26-033120').textContent).toContain('5.02 Departure')
    expect(screen.getByTestId('feed-source').textContent).toContain('SEC EDGAR submissions')
  })

  it('pending is said in words, never an empty list', async () => {
    routes['/api/research/filings-feed/AAPL'] = { state: 'pending', ticker: 'AAPL', source: 'SEC EDGAR submissions', rows: null,
      reason: 'the filing list is being read from SEC; it appears on a later visit' }
    wrap(<FilingsFeedTab sym="AAPL" />)
    expect((await screen.findByTestId('feed-gap')).textContent).toMatch(/^Pending: the filing list is being read/)
  })

  it('switches to the market-wide feed and filters by form', async () => {
    routes['/api/research/filings-feed?form=8-K'] = { state: 'ok', source: 'SEC EDGAR latest-filings feed', poll_minutes: 5, rows: [ROW_8K], forms: {} }
    routes['/api/research/filings-feed/AAPL'] = { state: 'ok', ticker: 'AAPL', source: 'SEC EDGAR submissions', rows: [ROW_8K] }
    routes['/api/research/filings-feed'] = { state: 'pending', source: 'SEC EDGAR latest-filings feed', rows: null, reason: 'the feed has not been polled yet on this server' }
    wrap(<FilingsFeedTab sym="AAPL" />)
    await screen.findByTestId('feed')
    fireEvent.click(screen.getByRole('button', { name: 'All market' }))
    fireEvent.click(screen.getByRole('button', { name: '8-K' }))
    await waitFor(() => expect(screen.getByTestId('feed-source').textContent).toContain('polled every 5 minutes'))
    expect(global.fetch.mock.calls.some(([u]) => String(u).endsWith('/api/research/filings-feed?form=8-K'))).toBe(true)
  })

  it('a failed request is unavailable, not "nothing filed"', async () => {
    status = 503
    wrap(<FilingsFeedTab sym="AAPL" />)
    expect((await screen.findByTestId('feed-unavailable')).textContent).toMatch(/not a finding about AAPL/)
  })
})
