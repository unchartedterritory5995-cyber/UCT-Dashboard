// Foreign filers on the two surfaces the first currency fix left: EEH (estimate
// history) and FA's yfinance fallback grids. Asserted on RENDERED TEXT: a TWD
// payload is labelled with its code and carries the note; a USD payload renders
// exactly as before (EEH: bare numbers; FA: "$"). Nothing is converted.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

let finData
vi.mock('../hooks/useFinancials', () => ({ default: () => ({ data: finData, isLoading: false }) }))

import EstimateHistoryTab from './EstimateHistoryTab'
import FinancialsTab from './FinancialsTab'

let routes
beforeEach(() => {
  routes = {}
  globalThis.fetch = vi.fn((url) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k))
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(key ? routes[key] : {}) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const wrap = (el) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{el}</SWRConfig>,
)

const eeh = (currency) => ({
  ticker: 'TSM', source: 'FMP /stable/analyst-estimates (period=quarter), snapshotted daily by UCT',
  currency, state: 'ok', covers_from: '2026-10-01', last_snapshot: '2026-10-01', snapshot_days: 1,
  failed_days: [],
  periods: [{
    period_end: '2026-12-31', n: 1, first_snapshot: '2026-10-01', state: 'collecting',
    reason: 'one snapshot so far (2026-10-01); a revision needs two',
    points: [{ snap_date: '2026-10-01', eps_avg: 18.5, eps_low: 17, eps_high: 20,
      rev_avg: 1.1e12, n_eps: 12, n_rev: 10 }],
  }],
})

describe('EstimateHistoryTab -- reporting currency', () => {
  it('labels a TWD consensus with its code and says it is not converted', async () => {
    routes['/api/research/estimate-history/TSM'] = eeh('TWD')
    wrap(<EstimateHistoryTab sym="TSM" />)
    const note = await screen.findByTestId('esthist-currency')
    expect(note.textContent).toContain('Figures in TWD')
    expect(note.textContent).toContain('Not converted to US dollars')
    const table = screen.getByTestId('period-2026-12-31')
    expect(table.textContent).toContain('EPS, TWD (low–high)')
    expect(table.textContent).toContain('Revenue, TWD')
    expect(table.textContent).toContain('TWD 18.50 (17.00–20.00)')
    expect(table.textContent).toContain('TWD 1.10T')
    expect(table.textContent).not.toContain('$')
  })

  it('renders a USD consensus exactly as before: bare numbers, no code, no note', async () => {
    routes['/api/research/estimate-history/AAPL'] = { ...eeh('USD'), ticker: 'AAPL' }
    wrap(<EstimateHistoryTab sym="AAPL" />)
    const table = await screen.findByTestId('period-2026-12-31')
    expect(table.textContent).toContain('18.50 (17.00–20.00)')
    expect(table.textContent).toContain('1.10T')
    expect(table.textContent).not.toContain('USD')
    expect(table.textContent).toContain('EPS (low–high)')
    expect(screen.queryByTestId('esthist-currency')).toBeNull()
  })

  it('an unknown currency (not cached yet) gets no label rather than a guess', async () => {
    routes['/api/research/estimate-history/TSM'] = eeh(null)
    wrap(<EstimateHistoryTab sym="TSM" />)
    const table = await screen.findByTestId('period-2026-12-31')
    expect(table.textContent).toContain('18.50 (17.00–20.00)')
    expect(table.textContent).not.toContain('$')
    expect(table.textContent).not.toContain('TWD')
    expect(screen.queryByTestId('esthist-currency')).toBeNull()
  })
})

const fin = (currency, cash) => ({
  sym: 'TSM', currency,
  quarterly: [{ period: 'Q2 2026', revenue: 1.06e12, net_income: 4e11, eps: 15.36, gross_margin: 59, operating_margin: 49, net_margin: 42, revenue_yoy: 38.6, eps_yoy: 60.7 }],
  annual: [{ period: '2025', revenue: 3.81e12, net_income: 1.7e12, eps: 66.25, gross_margin: 59, operating_margin: 49, net_margin: 45, revenue_yoy: 31.6, eps_yoy: 46.4 }],
  balance: { cash, total_debt: null, debt_to_equity: 20, current_ratio: 2.4, fcf: null },
  metrics: {},
})

describe('FinancialsTab (FA yfinance fallback) -- reporting currency', () => {
  it('labels TWD statement figures with the code, never "$", with the note', () => {
    finData = fin('TWD', 'TWD 3.52T')
    render(<FinancialsTab sym="TSM" />)
    expect(screen.getByText('TWD 1.06T')).toBeInTheDocument()       // quarterly revenue
    expect(screen.getByText('TWD 3.81T')).toBeInTheDocument()       // annual revenue
    expect(screen.getByText('TWD 3.52T')).toBeInTheDocument()       // cash, labelled server-side
    expect(screen.getAllByText('EPS, TWD').length).toBe(2)
    expect(screen.getByTestId('financials-currency').textContent).toContain('Figures in TWD')
    expect(document.body.textContent).not.toContain('$')
  })

  it('a USD filer keeps plain "$" and carries no note', () => {
    finData = { ...fin('USD', '$50.0B'), sym: 'NVDA' }
    render(<FinancialsTab sym="NVDA" />)
    expect(screen.getByText('$1.06T')).toBeInTheDocument()
    expect(screen.getByText('$50.0B')).toBeInTheDocument()
    expect(screen.getAllByText('EPS').length).toBe(2)
    expect(screen.queryByTestId('financials-currency')).toBeNull()
    expect(document.body.textContent).not.toContain('USD')
  })
})
