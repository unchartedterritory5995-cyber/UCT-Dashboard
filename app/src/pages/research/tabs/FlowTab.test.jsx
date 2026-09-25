import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen } from '../../../test-utils'

// A13 Wave B (2026-09-23). Deterministic only -- no AI, no new flow math.
// Source is the EXISTING, partner-owned GET /api/live/massive/ticker-flow
// endpoint via useResearchFlow.js.

let mockReturn = { data: null, isLoading: true }
vi.mock('../hooks/useResearchFlow', () => ({ default: () => mockReturn }))

import FlowTab from './FlowTab'

const bullish = {
  ok: true, symbol: 'AAPL', spot: 256.5,
  net: { bull: 500000, bear: 120000, unclassified: 0, dir: 'BULL' },
  window: { start: '9/18/2026', end: '9/23/2026', active_days: 4, days_requested: '5' },
  contract_count: 1,
  contracts: [{
    ticker: 'AAPL', cp: 'C', strike: 260, exp: '10/17/2026', dte: 24,
    premium: 500000, volume: 1200, oi: 3400, voi: 0.4, direction: 'Bull', perf: 12.5,
  }],
}

describe('FlowTab', () => {
  it('shows a loading state before data resolves', () => {
    mockReturn = { data: null, isLoading: true }
    renderWithProviders(<FlowTab sym="AAPL" />, { route: '/research/AAPL' })
    expect(screen.getByText('Loading options-flow evidence…')).toBeInTheDocument()
  })

  it('shows an honest empty state when the endpoint returns no qualifying contracts', () => {
    mockReturn = {
      data: { ok: true, symbol: 'AAPL', net: null, window: { days_requested: '5' }, contracts: [] },
      isLoading: false,
    }
    renderWithProviders(<FlowTab sym="AAPL" />, { route: '/research/AAPL' })
    expect(screen.getByTestId('flow-empty-state')).toHaveTextContent(
      'No qualifying options flow on AAPL in the last 5 trading days.',
    )
    expect(screen.queryByTestId('flow-net-summary')).not.toBeInTheDocument()
  })

  it('shows an honest empty state when the endpoint reports ok:false (no symbol)', () => {
    // The plain function returns {ok:false, error} rather than throwing --
    // the tab must never render a stale/undefined net summary against it.
    mockReturn = { data: { ok: false, error: 'no symbol' }, isLoading: false }
    renderWithProviders(<FlowTab sym="" />, { route: '/research/' })
    expect(screen.getByTestId('flow-empty-state')).toBeInTheDocument()
    expect(screen.queryByTestId('flow-net-summary')).not.toBeInTheDocument()
  })

  it('renders the net-flow summary with direction, premiums, spot, and window', () => {
    mockReturn = { data: bullish, isLoading: false }
    renderWithProviders(<FlowTab sym="AAPL" />, { route: '/research/AAPL' })
    const summary = screen.getByTestId('flow-net-summary')
    expect(summary).toHaveTextContent('BULL')
    expect(summary).toHaveTextContent('$500K')
    expect(summary).toHaveTextContent('$120K')
    expect(summary).toHaveTextContent('$256.50')
    expect(summary).toHaveTextContent('9/18/2026')
    expect(summary).toHaveTextContent('9/23/2026')
  })

  it('renders the top-contracts table with premium/volume/OI/perf', () => {
    mockReturn = { data: bullish, isLoading: false }
    renderWithProviders(<FlowTab sym="AAPL" />, { route: '/research/AAPL' })
    const rows = screen.getAllByTestId('flow-contract-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('260C 10/17/2026')
    expect(rows[0]).toHaveTextContent('$500K')
    expect(rows[0]).toHaveTextContent('1,200')
    expect(rows[0]).toHaveTextContent('3,400')
    expect(rows[0]).toHaveTextContent('+12.5%')
  })

  it('never fabricates a direction from unclassified premium', () => {
    // The backend's own "Unclear" bucket (real premium, no clean aggressor
    // side) is surfaced as a distinct number, never folded into bull/bear.
    mockReturn = {
      data: {
        ...bullish,
        net: { bull: 100000, bear: 50000, unclassified: 75000, dir: 'BULL' },
      },
      isLoading: false,
    }
    renderWithProviders(<FlowTab sym="AAPL" />, { route: '/research/AAPL' })
    expect(screen.getByTestId('flow-net-summary')).toHaveTextContent('$75K')
  })
})
