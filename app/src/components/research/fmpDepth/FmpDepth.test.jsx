// FA / EE on FMP — the depth views (terminal gap audit, gaps 3 and 4).
//
// Real SWR, a fresh cache per test, `fetch` stubbed per URL: no network. The
// payloads are the shapes api/services/research/financial_history.py and
// estimates_consensus.py return (tests/test_fa_ee_fmp_depth.py pins those).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../../../context/AuthContext'

vi.mock('../../research-kit', () => ({
  SeriesChart: (p) => <div data-testid="chart" data-label={p.label || ''} />,
  MetricTrendChart: () => <div data-testid="trend" />,
  EmptyState: ({ title, hint, onRetry }) => (
    <div data-testid="empty-state">
      <span>{title}</span><span>{hint}</span>
      {onRetry && <button type="button" onClick={onRetry}>Retry</button>}
    </div>
  ),
}))

import FinancialsDeep from './FinancialsDeep'
import ConsensusEstimates from './ConsensusEstimates'
import { buildTable, fmtMoney, fmtTimes, rowLabel, STATEMENTS } from './depthFormat'

const QUARTERS = Array.from({ length: 24 }, (_, i) => `Q${(i % 4) + 1} ${2021 + Math.floor(i / 4)}`)
const col = (f) => QUARTERS.map((_, i) => f(i))
const HISTORY_Q = {
  sym: 'NVDA', period: 'quarter', periods: QUARTERS, dates: col((i) => `2021-0${(i % 9) + 1}-28`),
  count: 24,
  series: {
    revenue: col((i) => 5e9 + i * 1e9), operating_income: col((i) => 1e9 + i * 5e8),
    net_income: col((i) => 8e8 + i * 4e8), eps: col((i) => 0.3 + i * 0.05),
    gross_profit: col((i) => 3e9 + i * 7e8), operating_expenses: col(() => 2e9),
    total_assets: col(() => 1e11), total_liabilities: col(() => 4e10),
    free_cash_flow: col((i) => 7e8 + i * 3e8), operating_cash_flow: col(() => 1e9),
    total_equity: col(() => 6e10), inventory: col(() => null),
  },
  ratios: { gross_margin: col(() => 61.5), roe: col((i) => (i < 3 ? null : 40)), current_ratio: col(() => 3.5) },
  source: { vendor: 'FMP', basis: 'fiscal', endpoints: ['/stable/income-statement'], fetched_at: 1759500000 },
}
const HISTORY_A = { ...HISTORY_Q, period: 'annual', periods: ['2023', '2024', '2025'],
  series: { revenue: [2.7e10, 6.1e10, 1.3e11] }, ratios: {}, count: 3 }

const CONSENSUS = {
  state: 'ok', source: 'FMP /stable/analyst-estimates', fetched_at: 1759500000,
  // NVDA reports in USD and FMP says so; an unstated currency renders no "$" (UnknownCurrency.test.jsx).
  currency: 'USD',
  annual: ['2026', '2027', '2028', '2029'].map((y, i) => ({
    period_end: `${y}-01-31`, label: `FY${y}`,
    eps: { avg: 4 + i, low: 3.5 + i, high: 4.5 + i, n: 40 - i * 5 },
    revenue: { avg: 2e11 + i * 3e10, low: 1.9e11, high: 2.3e11, n: 38 },
    eps_growth: 20, revenue_growth: 15, ebitda_avg: 1.2e11, net_income_avg: 1e11,
  })),
  quarterly: [{ period_end: '2026-10-31', label: 'Q3 2027', eps: { avg: 1.1, low: 1, high: 1.2, n: 30 },
    revenue: { avg: 5.4e10, low: 5e10, high: 5.8e10, n: 30 }, eps_growth: 50, revenue_growth: 45 }],
}
const ESTIMATES = (consensus) => ({
  sym: 'NVDA', entity: null,
  forward: [{ period: 'Current Qtr', eps_avg: 1.0, eps_low: 0.9, eps_high: 1.1, num_analysts: 30, eps_growth: 40, rev_avg: 5e10 }],
  revisions: [{ period: 'Current Qtr', current: 1.0, ago30: 0.95, ago90: 0.9, up30: 12, down30: 1 }],
  consensus, sources: { forward: 'Yahoo Finance', revisions: 'Yahoo Finance', consensus: 'FMP' },
})

let routes
let calls
beforeEach(() => {
  calls = []
  routes = {}
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(url)
    const r = Object.entries(routes).find(([k]) => url.startsWith(k))
    if (!r) return { ok: false, status: 404, json: async () => ({}) }
    const v = typeof r[1] === 'function' ? r[1](url) : r[1]
    if (v instanceof Error) throw v
    return { ok: true, status: 200, json: async () => v }
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

function mount(node, auth = {}) {
  return render(
    <AuthContext.Provider value={auth}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        {node}
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

describe('depthFormat — every number through the presentation primitives', () => {
  it('money spans T / B / M and keeps a missing value a dash', () => {
    // A STATED USD reads "$"; an unstated currency is bare (owner decision 2026-10-07).
    expect(fmtMoney(3.12e12, 'USD')).toBe('$3.12T')
    expect(fmtMoney(9.493e10, 'USD')).toBe('$94.93B')
    expect(fmtMoney(4.88e7, 'USD')).toBe('$48.8M')
    expect(fmtMoney(4.88e7)).toBe('48.8M')
    expect(fmtMoney(null)).toBe('—')
    expect(fmtTimes(1.4286)).toBe('1.43×')
    expect(fmtTimes(null)).toBe('—')
  })

  it('tables read NEWEST FIRST and drop a row with no values at all', () => {
    const t = buildTable(HISTORY_Q, 'balance')
    expect(t.columns[0]).toBe('Q4 2026')
    expect(t.columns).toHaveLength(24)
    expect(t.rows.map((r) => r.key)).not.toContain('inventory')
    expect(t.rows.map((r) => r.key)).toContain('total_equity')
  })

  it('quarterly ROE / ROA say TTM; annual ones do not', () => {
    expect(rowLabel('Return on equity', 'ttm', 'quarter')).toBe('Return on equity (TTM)')
    expect(rowLabel('Return on equity', 'ttm', 'annual')).toBe('Return on equity')
  })

  it('covers income, balance, cash flow and ratios', () => {
    expect(STATEMENTS.map((s) => s.key)).toEqual(['income', 'balance', 'cash', 'ratios'])
  })
})

describe('FA — FinancialsDeep', () => {
  it('shows >= 20 fiscal quarters from FMP with an FMP source line', async () => {
    routes['/api/research/financial-history/NVDA?period=quarter'] = HISTORY_Q
    routes['/api/research/financial-history/NVDA?period=annual'] = HISTORY_A
    mount(<FinancialsDeep sym="nvda" />)
    const tables = await screen.findByTestId('statement-tables')
    const table = await within(tables).findByRole('table')
    const heads = within(table).getAllByRole('columnheader')
    expect(heads.length - 1).toBeGreaterThanOrEqual(20)
    expect(heads[0]).toHaveTextContent('Fiscal quarter')
    expect(screen.getByTestId('depth-source')).toHaveAttribute('data-vendor', 'FMP')
    expect(screen.getByTestId('depth-source')).toHaveAttribute('data-fallback', 'false')
    expect(screen.getByTestId('fa-deep')).toHaveAttribute('data-source', 'fmp')
    // labels identical to the ERN modal's panels: the SAME payload, the SAME `periods`
    expect(heads[1]).toHaveTextContent(QUARTERS[QUARTERS.length - 1])
  })

  it('switches statement and period through labelled toggles', async () => {
    routes['/api/research/financial-history/NVDA?period=quarter'] = HISTORY_Q
    routes['/api/research/financial-history/NVDA?period=annual'] = HISTORY_A
    mount(<FinancialsDeep sym="NVDA" />)
    const tables = await screen.findByTestId('statement-tables')
    fireEvent.click(within(within(tables).getByRole('group', { name: 'Statement' })).getByRole('button', { name: 'Ratios' }))
    expect(await within(tables).findByText('Return on equity (TTM)')).toBeInTheDocument()
    fireEvent.click(within(within(tables).getByRole('group', { name: 'Reporting period' })).getByRole('button', { name: 'Annual' }))
    await waitFor(() => expect(calls.some((u) => u.includes('period=annual'))).toBe(true))
  })

  it('a FAILED request is an error with retry, never "unavailable for this ticker"', async () => {
    routes['/api/research/financial-history/NVDA'] = new TypeError('Failed to fetch')
    mount(<FinancialsDeep sym="NVDA" />)
    expect(await screen.findByText('Could not load this section')).toBeInTheDocument()
    expect(screen.queryByText(/unavailable for this ticker/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('FMP empty => the yfinance grids, LABELLED as the fallback', async () => {
    routes['/api/research/financial-history/ZZZ'] = { sym: 'ZZZ', period: 'quarter', periods: [], series: {} }
    routes['/api/research/financials/ZZZ'] = { sym: 'ZZZ', quarterly: [], annual: [], balance: {}, metrics: {} }
    mount(<FinancialsDeep sym="ZZZ" />)
    const src = await screen.findByTestId('depth-source')
    expect(src).toHaveAttribute('data-vendor', 'Yahoo Finance')
    expect(src).toHaveAttribute('data-fallback', 'true')
    expect(src).toHaveTextContent('Fallback: Yahoo Finance')
    expect(src).toHaveTextContent(/FMP holds no statement history/)
  })

  // Audit 2026-10-08 (FA, point 20): the source detail is member copy, never a vendor endpoint
  // path or a library method name.
  it('the FMP source detail names no endpoint path', async () => {
    routes['/api/research/financial-history/NVDA?period=quarter'] = HISTORY_Q
    routes['/api/research/financial-history/NVDA?period=annual'] = HISTORY_A
    mount(<FinancialsDeep sym="NVDA" />)
    const src = await screen.findByTestId('depth-source')
    fireEvent.click(within(src).getByTestId('provenance-detail-toggle'))
    const panel = within(src).getByTestId('provenance-detail-panel')
    expect(panel).toHaveTextContent('Source: FMP quarterly and annual financial statements')
    expect(panel).not.toHaveTextContent(/\/stable\//)
  })

  it('the Yahoo fallback detail names no library method', async () => {
    routes['/api/research/financial-history/ZZZ'] = { sym: 'ZZZ', period: 'quarter', periods: [], series: {} }
    routes['/api/research/financials/ZZZ'] = { sym: 'ZZZ', quarterly: [], annual: [], balance: {}, metrics: {} }
    mount(<FinancialsDeep sym="ZZZ" />)
    const src = await screen.findByTestId('depth-source')
    expect(src).not.toHaveTextContent(/yfinance/)
    fireEvent.click(within(src).getByTestId('provenance-detail-toggle'))
    const panel = within(src).getByTestId('provenance-detail-panel')
    expect(panel).not.toHaveTextContent(/yfinance|income_stmt|_/)
  })

  it('the loading line is announced (role=status)', () => {
    routes['/api/research/financial-history/NVDA'] = new Promise(() => {})
    mount(<FinancialsDeep sym="NVDA" />)
    expect(screen.getByRole('status')).toHaveTextContent(/Loading financials…|warming/i)
  })
})

describe('quality pass 2026-10-05: a failed leg is not a finding', () => {
  it('FA: a failed FMP history read says so on the fallback line, not "holds no history"', async () => {
    routes['/api/research/financial-history/ZZZ'] = { sym: 'ZZZ', period: 'quarter', periods: [], series: {}, fmp_unavailable: true }
    routes['/api/research/financials/ZZZ'] = { sym: 'ZZZ', quarterly: [], annual: [], balance: {}, metrics: {} }
    mount(<FinancialsDeep sym="ZZZ" />)
    const src = await screen.findByTestId('depth-source')
    expect(src).toHaveTextContent(/could not be read right now; showing Yahoo Finance/)
    expect(src).not.toHaveTextContent(/holds no statement history/)
  })

  it('EE: FMP erroring and Yahoo failing is "could not be read", never "Neither ... holds"', async () => {
    routes['/api/research/estimates/ZZZ?consensus=1'] = { sym: 'ZZZ', entity: null, forward: [], revisions: [], yf_unavailable: true,
      consensus: { state: 'error', annual: [], quarterly: [] } }
    mount(<ConsensusEstimates sym="ZZZ" />)
    expect((await screen.findByTestId('ee-unread')).textContent).toMatch(/not a finding about ZZZ/)
    expect(screen.queryByText(/Neither FMP nor Yahoo/)).toBeNull()
  })

  it('EE: both genuinely empty still says neither holds any', async () => {
    routes['/api/research/estimates/ZZZ?consensus=1'] = { sym: 'ZZZ', entity: null, forward: [], revisions: [],
      consensus: { state: 'empty', annual: [], quarterly: [] } }
    mount(<ConsensusEstimates sym="ZZZ" />)
    expect(await screen.findByText(/Neither FMP nor Yahoo Finance holds forward estimates/)).toBeInTheDocument()
  })
})

describe('EE — ConsensusEstimates', () => {
  it('renders >= 3 forward FMP fiscal years with # analysts and hi/lo', async () => {
    routes['/api/research/estimates/NVDA?consensus=1'] = ESTIMATES(CONSENSUS)
    mount(<ConsensusEstimates sym="NVDA" />)
    const card = await screen.findByTestId('ee-consensus')
    const rows = within(within(card).getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows[0]).toHaveTextContent('FY2026')
    expect(rows[0]).toHaveTextContent('$4.00')
    expect(rows[0]).toHaveTextContent('$3.50 – $4.50')
    expect(rows[0]).toHaveTextContent('40')
    expect(within(card).getByTestId('depth-source')).toHaveAttribute('data-vendor', 'FMP')
    expect(calls[0]).toBe('/api/research/estimates/NVDA?consensus=1')
  })

  it('quarterly is one labelled toggle away', async () => {
    routes['/api/research/estimates/NVDA?consensus=1'] = ESTIMATES(CONSENSUS)
    mount(<ConsensusEstimates sym="NVDA" />)
    const card = await screen.findByTestId('ee-consensus')
    fireEvent.click(within(within(card).getByRole('group', { name: 'Estimate period' })).getByRole('button', { name: 'Quarterly' }))
    expect(within(card).getByText('Q3 2027')).toBeInTheDocument()
  })

  it('revisions stay, labelled as Yahoo Finance', async () => {
    routes['/api/research/estimates/NVDA?consensus=1'] = ESTIMATES(CONSENSUS)
    mount(<ConsensusEstimates sym="NVDA" />)
    const rev = await screen.findByTestId('ee-revisions')
    expect(within(rev).getByTestId('depth-source')).toHaveAttribute('data-vendor', 'Yahoo Finance')
    expect(within(rev).getByTestId('depth-source')).toHaveAttribute('data-fallback', 'false')
  })

  it.each([['empty', /no forward consensus/], ['error', /did not answer/]])(
    'FMP %s => the yfinance forward table, labelled as the fallback', async (state, reason) => {
      routes['/api/research/estimates/NVDA?consensus=1'] = ESTIMATES({ state, annual: [], quarterly: [] })
      mount(<ConsensusEstimates sym="NVDA" />)
      const fb = await screen.findByTestId('ee-fallback')
      const src = within(fb).getByTestId('depth-source')
      expect(src).toHaveAttribute('data-fallback', 'true')
      expect(src).toHaveTextContent(reason)
      expect(within(fb).getByText('Current Qtr')).toBeInTheDocument()
    })

  // Completeness audit 2026-10-07: "FMP did not answer" was printed whenever the state was not
  // exactly 'empty' -- including when FMP DID answer, with nothing in it. Worded per case now.
  it.each([
    ['FMP answered with no forward periods', { state: 'ok', annual: [], quarterly: [] }, /no forward consensus/],
    ['one FMP leg failed and the other answered empty',
      { state: 'error', annual: [], quarterly: [], errors: { annual: 'timeout' } },
      /annual read failed and its quarterly answer holds no forward periods/],
  ])('EE fallback wording: %s is never "did not answer"', async (_name, consensus, reason) => {
    routes['/api/research/estimates/NVDA?consensus=1'] = ESTIMATES(consensus)
    mount(<ConsensusEstimates sym="NVDA" />)
    const src = within(await screen.findByTestId('ee-fallback')).getByTestId('depth-source')
    expect(src).toHaveTextContent(reason)
    expect(src).not.toHaveTextContent(/did not answer/)
  })

  it('a FAILED request is an error with retry', async () => {
    routes['/api/research/estimates/NVDA'] = new TypeError('Failed to fetch')
    mount(<ConsensusEstimates sym="NVDA" />)
    expect(await screen.findByText('Could not load this section')).toBeInTheDocument()
  })

  it('points to EEH only when estimate history is on', async () => {
    routes['/api/research/estimates/NVDA?consensus=1'] = ESTIMATES(CONSENSUS)
    const { unmount } = mount(<ConsensusEstimates sym="NVDA" />)
    await screen.findByTestId('ee-consensus')
    expect(screen.queryByTestId('ee-history-pointer')).toBeNull()
    unmount()
    mount(<ConsensusEstimates sym="NVDA" />, { estimateHistoryEnabled: true })
    expect(await screen.findByTestId('ee-history-pointer')).toBeInTheDocument()
  })
})

// tq-panels: the route marks a fund (e910f8ff6) -- FA and EE say "not applicable to funds".
describe('a fund on FA / EE', () => {
  it('FA: a fund with no FMP history says not applicable, not the yfinance fallback', async () => {
    routes['/api/research/financial-history/SPY'] = { sym: 'SPY', period: 'quarter', periods: [], series: {},
      not_applicable: 'fund', reason: 'SPY is a fund; funds report no company income statement, balance sheet or cash flow' }
    mount(<FinancialsDeep sym="SPY" />)
    expect((await screen.findByTestId('fa-na')).textContent)
      .toBe('Not applicable to funds: SPY is a fund; funds report no company income statement, balance sheet or cash flow.')
    expect(screen.queryByText(/FMP holds no statement history/)).toBeNull()
  })

  it('EE: a fund with nothing from either vendor says not applicable, not "Neither ... holds"', async () => {
    routes['/api/research/estimates/SPY?consensus=1'] = { sym: 'SPY', entity: null, forward: [], revisions: [],
      consensus: { state: 'empty', annual: [], quarterly: [] },
      not_applicable: 'fund', reason: 'SPY is a fund; analysts publish no earnings or revenue estimates for a fund' }
    mount(<ConsensusEstimates sym="SPY" />)
    expect((await screen.findByTestId('ee-na')).textContent)
      .toBe('Not applicable to funds: SPY is a fund; analysts publish no earnings or revenue estimates for a fund.')
    expect(screen.queryByText(/Neither FMP nor Yahoo/)).toBeNull()
  })
})
