import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// 2026-09-03 dedicated Analyst Ratings slice (owner-authorized product-home
// split): EstimatesTab is narrowed to forward estimates + revisions only.
// Consensus / price-target / recent-rating-change coverage moved to
// AnalystRatingsTab.test.jsx -- this file no longer references those fields.

const data = {
  sym: 'AAPL',
  forward: [
    { period: 'Current Qtr', eps_avg: 2.10, eps_low: 2.0, eps_high: 2.2, num_analysts: 12, eps_growth: 15.0, rev_avg: 9.5e10 },
  ],
  revisions: [
    { period: 'Current Qtr', current: 2.10, ago30: 2.05, ago90: 1.95, up30: 5, down30: 1 },
  ],
}

vi.mock('../hooks/useEstimates', () => ({ default: () => ({ data, isLoading: false }) }))

import EstimatesTab from './EstimatesTab'

describe('EstimatesTab', () => {
  it('renders forward estimates and revisions', () => {
    render(<EstimatesTab sym="AAPL" />)
    expect(screen.getByText('Forward estimates (analyst consensus)')).toBeInTheDocument()
    expect(screen.getByText('+15.0%')).toBeInTheDocument()      // eps growth
    expect(screen.getByText('$95.00B')).toBeInTheDocument()     // revenue avg
    expect(screen.getByText('EPS estimate revisions')).toBeInTheDocument()
  })

  it('does not render any analyst-consensus / price-target / rating-change content', () => {
    render(<EstimatesTab sym="AAPL" />)
    expect(screen.queryByText('Analyst consensus')).not.toBeInTheDocument()
    expect(screen.queryByText('Price target')).not.toBeInTheDocument()
    expect(screen.queryByText('Recent rating changes')).not.toBeInTheDocument()
    expect(screen.queryByText('Recent analyst actions')).not.toBeInTheDocument()
  })
})

describe('EstimatesTab -- entity + empty state', () => {
  it('renders an honest note when the symbol has not resolved to a canonical entity', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useEstimates', () => ({
      default: () => ({
        data: { sym: 'ZZZ', entity: { status: 'not_found', entityId: null }, forward: [], revisions: [] },
        isLoading: false,
      }),
    }))
    const { default: FreshEstimatesTab } = await import('./EstimatesTab')
    render(<FreshEstimatesTab sym="ZZZ" />)
    expect(screen.getByTestId('entity-unresolved-note')).toHaveTextContent('not_found')
  })

  it('shows the empty-state note when forward and revisions are both empty', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useEstimates', () => ({
      default: () => ({
        data: { sym: 'ZZZ', entity: { status: 'resolved', entityId: 'e_1' }, forward: [], revisions: [] },
        isLoading: false,
      }),
    }))
    const { default: FreshEstimatesTab } = await import('./EstimatesTab')
    render(<FreshEstimatesTab sym="ZZZ" />)
    expect(screen.getByText('Estimate data is unavailable for this ticker.')).toBeInTheDocument()
  })
})
