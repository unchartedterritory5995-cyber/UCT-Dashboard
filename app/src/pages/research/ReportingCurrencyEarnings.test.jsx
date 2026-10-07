// Foreign filers on the earnings surfaces: DES "Latest report" and Depth's
// earnings reaction. Asserted on RENDERED TEXT. TSM reports in Taiwan dollars:
// revenue carries "TWD", EPS carries no symbol (its sources do not share one
// stated currency) and a note says so. A USD payload renders exactly as before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../components/FundamentalSnapshot', () => ({ default: () => null }))
vi.mock('./DeskCoverage', () => ({ default: () => null }))
vi.mock('./LeadershipBadge', () => ({ default: () => null }))
vi.mock('./ConfidenceBadge', () => ({ default: () => null }))
vi.mock('../../components/chart/pane/ChartPane', () => ({ default: () => null }))

import { latestReportRow } from './hooks/useLatestReport'
import OverviewTab from './tabs/OverviewTab'
import DepthTab from './depth/DepthTab'

const intel = (currency) => ({
  currency,
  quarters: [{ label: 'FY26 Q2', eps_actual: 15.36, eps_estimate: 14.9, eps_surprise_pct: 3.1,
    revenue_actual: 1.06e12, revenue_estimate: 1.04e12, rev_surprise_pct: 1.9 }],
})

const renderDes = (row) => render(
  <OverviewTab sym="TSM" stats={{}} analyst={{}} ai={{}} row={row} reportState="ready" error={false} mutate={() => {}} />,
)

describe('DES Latest report -- reporting currency', () => {
  afterEach(cleanup)

  it('TWD: revenue carries the code, EPS no symbol, with the note', () => {
    renderDes(latestReportRow(intel('TWD')))
    expect(screen.getByText('TWD 1.06T')).toBeInTheDocument()
    expect(screen.getByText('TWD 1.04T')).toBeInTheDocument()
    expect(screen.getByText('15.36')).toBeInTheDocument()
    expect(screen.getByText('14.90')).toBeInTheDocument()
    expect(screen.getByTestId('latest-report-currency').textContent).toContain('Revenue in TWD')
    expect(document.body.textContent).not.toContain('$')
  })

  it('USD: plain "$" exactly as before, no note', () => {
    renderDes(latestReportRow(intel('USD')))
    expect(screen.getByText('$1.06T')).toBeInTheDocument()
    expect(screen.getByText('$15.36')).toBeInTheDocument()
    expect(screen.queryByTestId('latest-report-currency')).toBeNull()
    expect(latestReportRow(intel('USD'))).toEqual(latestReportRow(intel(null)))
  })
})

const reaction = (currency) => ({
  state: 'ok', ticker: 'TSM', bars_through: '2026-10-01', source: 'UCT daily bar store', currency,
  next_report_date: '2026-10-16',
  quarters: [{ quarter: 'FY26 Q2', report_date: '2026-07-16', session: '2026-07-17', run_in_pct: 2.1,
    gap_pct: 1.4, reaction_pct: 3.25, drift_pct: -1.2, drift_state: 'measured', eps_actual: 15.36, eps_estimate: 14.9 }],
  summary: {},
  implied_move: { state: 'ok', pct: 6.8, dollar: 12.4, expiry: '2026-10-17', strike: 290, call_mark: 6.3, put_mark: 6.1, read_at: 1790000000 },
})

let body
beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderDepth = (sym) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym={sym} flags={{ earnings_reaction_panel_enabled: true }} />
  </SWRConfig>,
)

describe('Earnings reaction -- reporting currency', () => {
  it('TWD: EPS without "$", the note names the currency; the US option chain move stays "$"', async () => {
    body = reaction('TWD')
    renderDepth('tsm')
    const row = await screen.findByTestId('earnings-reaction-row')
    expect(row.textContent).toContain('15.36 vs 14.90')
    expect(row.textContent).not.toContain('$')
    expect(screen.getByTestId('earnings-reaction-currency').textContent).toContain('TSM reports in TWD')
    expect(screen.getByTestId('implied-move').textContent).toContain('$12.40')
  })

  it('USD: EPS keeps "$", no note', async () => {
    body = { ...reaction('USD'), ticker: 'NVDA' }
    renderDepth('nvda')
    const row = await screen.findByTestId('earnings-reaction-row')
    expect(row.textContent).toContain('$15.36 vs $14.90')
    expect(screen.queryByTestId('earnings-reaction-currency')).toBeNull()
  })
})

const broker = (currency) => ({
  ticker: 'TSM', state: 'ok', currency, source: 'FMP /stable/analyst-estimates (period=quarter), consensus aggregates',
  contributors: { state: 'unavailable', reason: 'FMP returns consensus aggregates only' },
  firms: { state: 'empty', source: 'FMP grades', actions: [] },
  periods: [{ period_end: '2026-12-31',
    eps: { mean: 18.5, low: 17, high: 20, n: 12, dispersion_pct: 16.2 },
    revenue: { mean: 1.1e12, low: 1, high: 2, n: 10, dispersion_pct: 3.1 } }],
})

const renderBroker = (sym) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym={sym} flags={{ broker_estimates_enabled: true }} />
  </SWRConfig>,
)

describe('Estimates by contributor -- reporting currency', () => {
  it('TWD: means carry the code, headers name it, the note says not converted', async () => {
    body = broker('TWD')
    renderBroker('tsm')
    const row = await screen.findByTestId('broker-row')
    expect(row.textContent).toContain('TWD 18.50')
    expect(row.textContent).toContain('TWD 1.10T')
    expect(screen.getByText('EPS mean, TWD')).toBeInTheDocument()
    expect(screen.getByTestId('broker-currency').textContent).toContain('Figures in TWD')
  })

  it('USD: bare numbers exactly as before, no note', async () => {
    body = { ...broker('USD'), ticker: 'NVDA' }
    renderBroker('nvda')
    const row = await screen.findByTestId('broker-row')
    expect(row.textContent).toContain('18.50')
    expect(row.textContent).toContain('1.10T')
    expect(row.textContent).not.toContain('USD')
    expect(row.textContent).not.toContain('$')
    expect(screen.queryByTestId('broker-currency')).toBeNull()
  })
})
