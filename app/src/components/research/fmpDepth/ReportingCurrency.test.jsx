// Foreign filers: figures in the company's REPORTING currency say so on screen.
//
// The defect (production, 2026-10-06): `TSM EE` printed FMP's FY2026 consensus
// EPS as "$535.87" and revenue as "$5.40T". Those are Taiwan dollars; TSM's US
// ADR earns about $17. The server now states the currency (`currency: "TWD"`)
// and these tests assert the RENDERED TEXT: a TWD fixture reads "TWD", carries
// the visible note, and never "$535.87"; a USD fixture reads "$" as before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../../../context/AuthContext'

vi.mock('../../research-kit', () => ({
  SeriesChart: (p) => <div data-testid="chart" data-label={p.label || ''}
    data-tick={p.valueFormatter ? p.valueFormatter(1.59e9) : ''} />,
  MetricTrendChart: () => <div data-testid="trend" />,
  CoverageNote: () => null,
  EmptyState: ({ title }) => <div data-testid="empty-state">{title}</div>,
}))

const snapshot = { data: null }
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({
  default: () => ({ data: snapshot.data, isLoading: false }),
}))

import FinancialsDeep from './FinancialsDeep'
import ConsensusEstimates from './ConsensusEstimates'
import FundamentalSnapshot from '../../FundamentalSnapshot'
import {
  formatCurrency, formatCurrencyIn, relabelDollarText, reportingCurrencyNote,
} from '../../../lib/presentation/presentationPrimitives'

const row = (y, eps, rev) => ({
  period_end: `${y}-12-31`, label: `FY${y}`,
  eps: { avg: eps, low: eps * 0.9, high: eps * 1.05, n: 20 },
  revenue: { avg: rev, low: rev * 0.95, high: rev * 1.04, n: 18 },
  eps_growth: 25, revenue_growth: 20, ebitda_avg: rev * 0.7, net_income_avg: rev * 0.45,
})
const consensus = (currency, rows) => ({
  state: 'ok', source: 'FMP /stable/analyst-estimates', fetched_at: 1759500000,
  annual: rows, quarterly: [], currency,
})
const estimates = (c, extra = {}) => ({
  sym: 'X', entity: null, forward: [], revisions: [], consensus: c,
  sources: { forward: 'Yahoo Finance', revisions: 'Yahoo Finance', consensus: 'FMP' },
  reporting_currency: c?.currency ?? null, ...extra,
})

const Q = ['Q3 2025', 'Q4 2025', 'Q1 2026', 'Q2 2026']
const history = (sym, currency) => ({
  sym, period: 'quarter', periods: Q, dates: Q.map(() => '2026-06-30'), count: 4, currency,
  series: { revenue: [1.1e12, 1.2e12, 1.13e12, 1.27e12], net_income: [4e11, 4.2e11, 4.5e11, 5e11],
    eps: [15.5, 16.2, 17.4, 19.3] },
  ratios: {},
  source: { vendor: 'FMP', basis: 'fiscal', endpoints: ['/stable/income-statement'], fetched_at: 1759500000 },
})

let routes
beforeEach(() => {
  routes = {}
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const r = Object.entries(routes).find(([k]) => url.startsWith(k))
    if (!r) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => r[1] }
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

const mount = (node) => render(
  <AuthContext.Provider value={{}}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      {node}
    </SWRConfig>
  </AuthContext.Provider>,
)

describe('the currency primitives', () => {
  it('label a non-dollar figure with its code, inside the sign', () => {
    expect(formatCurrencyIn(535.87, 'TWD')).toBe('TWD 535.87')
    expect(formatCurrencyIn(-2.9, 'twd')).toBe('-TWD 2.90')
    expect(formatCurrencyIn(null, 'TWD')).toBe('—')
    expect(relabelDollarText('-$450.0M', 'JPY')).toBe('-JPY 450.0M')
  })

  it('USD and unknown are byte-identical to formatCurrency', () => {
    for (const v of [4, -2.9, 0, 1234.5, null]) {
      expect(formatCurrencyIn(v, 'USD')).toBe(formatCurrency(v))
      expect(formatCurrencyIn(v, null)).toBe(formatCurrency(v))
    }
    expect(relabelDollarText('$1.59B', 'USD')).toBe('$1.59B')
    expect(reportingCurrencyNote('USD')).toBeNull()
    expect(reportingCurrencyNote(null)).toBeNull()
  })
})

describe('EE — TSM in TWD, NVDA in USD', () => {
  it('a TWD consensus reads TWD with a visible note, never "$535.87"', async () => {
    routes['/api/research/estimates/TSM?consensus=1'] =
      estimates(consensus('TWD', [row(2026, 535.87, 5.4e12), row(2027, 690, 7.3e12)]))
    mount(<ConsensusEstimates sym="TSM" />)
    const card = await screen.findByTestId('ee-consensus')
    const first = within(within(card).getByRole('table')).getAllByRole('row')[1]
    expect(first).toHaveTextContent('TWD 535.87')
    expect(first).toHaveTextContent('TWD 5.40T')
    expect(card).not.toHaveTextContent('$535.87')
    expect(card).not.toHaveTextContent('$5.40T')
    const note = within(card).getByTestId('ee-currency')
    expect(note).toHaveTextContent("Figures in TWD, the company's reporting currency")
    expect(note).toHaveTextContent('Not converted to US dollars')
    expect(within(card).getByTestId('chart')).toHaveAttribute('data-tick', 'TWD 1590000000.00')
  })

  it('a USD consensus reads plain "$" and carries no note', async () => {
    routes['/api/research/estimates/NVDA?consensus=1'] =
      estimates(consensus('USD', [row(2026, 4, 2e11), row(2027, 5, 2.3e11)]))
    mount(<ConsensusEstimates sym="NVDA" />)
    const card = await screen.findByTestId('ee-consensus')
    const first = within(within(card).getByRole('table')).getAllByRole('row')[1]
    expect(first).toHaveTextContent('$4.00')
    expect(first).toHaveTextContent('$200.00B')
    expect(within(card).queryByTestId('ee-currency')).toBeNull()
  })

  it('the Yahoo fallback for a TWD filer labels revenue TWD and gives EPS no "$"', async () => {
    routes['/api/research/estimates/TSM?consensus=1'] = estimates(
      { state: 'empty', annual: [], quarterly: [], currency: 'TWD' },
      { forward: [{ period: 'Current Yr', eps_avg: 16.95, eps_low: 15.23, eps_high: 17.8,
        num_analysts: 20, eps_growth: 30, rev_avg: 5.443e12 }],
      revisions: [{ period: 'Current Yr', current: 16.95, ago30: 16.5, ago90: 15.9, up30: 4, down30: 0 }] })
    mount(<ConsensusEstimates sym="TSM" />)
    const fb = await screen.findByTestId('ee-fallback')
    expect(fb).toHaveTextContent('TWD 5.44T')
    expect(fb).toHaveTextContent('16.95')
    expect(fb).not.toHaveTextContent('$16.95')
    expect(within(fb).getByTestId('ee-yahoo-currency')).toHaveTextContent('Revenue in TWD')
    expect(screen.getByTestId('ee-revisions')).not.toHaveTextContent('$16.95')
  })
})

describe('FA — statements in their reporting currency', () => {
  it('TSM statements read TWD in the table and the panels, with the note', async () => {
    routes['/api/research/financial-history/TSM?period=quarter'] = history('TSM', 'TWD')
    mount(<FinancialsDeep sym="TSM" />)
    const tables = await screen.findByTestId('statement-tables')
    const table = await within(tables).findByRole('table')
    const revenue = within(table).getAllByRole('row').find((r) => r.getAttribute('data-row') === 'revenue')
    expect(revenue).toHaveTextContent('TWD 1.27T')
    expect(revenue).not.toHaveTextContent('$')
    const eps = within(table).getAllByRole('row').find((r) => r.getAttribute('data-row') === 'eps')
    expect(eps).toHaveTextContent('TWD 19.30')
    expect(within(tables).getByTestId('fa-currency')).toHaveTextContent('Figures in TWD')
    expect(await screen.findByTestId('panels-currency')).toHaveTextContent('Figures in TWD')
    const ticks = screen.getAllByTestId('chart').map((c) => c.getAttribute('data-tick'))
    expect(ticks).toContain('TWD 1.59B')
    expect(ticks.join(' ')).not.toContain('$')
  })

  it('a USD filer reads "$" with no note', async () => {
    routes['/api/research/financial-history/NVDA?period=quarter'] = history('NVDA', 'USD')
    mount(<FinancialsDeep sym="NVDA" />)
    const tables = await screen.findByTestId('statement-tables')
    const table = await within(tables).findByRole('table')
    const revenue = within(table).getAllByRole('row').find((r) => r.getAttribute('data-row') === 'revenue')
    expect(revenue).toHaveTextContent('$1.27T')
    expect(within(tables).queryByTestId('fa-currency')).toBeNull()
    expect(screen.queryByTestId('panels-currency')).toBeNull()
  })
})

describe('DES snapshot — no ratio mixing a USD price with TWD statements', () => {
  it('says why P/S and P/B are a dash for TSM', () => {
    snapshot.data = { name: 'Taiwan Semiconductor', metrics: { market_cap: '$2.51T', pe_forward: 22.06,
      ps: null, pb: null, free_cash_flow: 'TWD 730.83B' },
    reporting_currency: 'TWD', currency_withheld: { ps: 'x', pb: 'x', ev_to_revenue: 'x' } }
    render(<FundamentalSnapshot sym="TSM" />)
    const note = screen.getByTestId('snapshot-currency')
    expect(note).toHaveTextContent('P/S and P/B not shown')
    expect(note).toHaveTextContent('TWD')
    expect(screen.getByText('TWD 730.83B')).toBeInTheDocument()
  })

  it('shows no note for a US name', () => {
    snapshot.data = { name: 'NVIDIA', metrics: { ps: 19.31, pb: 25.54, free_cash_flow: '$41.81B' },
      reporting_currency: 'USD', currency_withheld: {} }
    render(<FundamentalSnapshot sym="NVDA" />)
    expect(screen.queryByTestId('snapshot-currency')).toBeNull()
    expect(screen.getByText('19.31')).toBeInTheDocument()
  })
})
