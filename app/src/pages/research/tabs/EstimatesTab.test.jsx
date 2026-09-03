import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const data = {
  sym: 'AAPL',
  forward: [
    { period: 'Current Qtr', eps_avg: 2.10, eps_low: 2.0, eps_high: 2.2, num_analysts: 12, eps_growth: 15.0, rev_avg: 9.5e10 },
  ],
  revisions: [
    { period: 'Current Qtr', current: 2.10, ago30: 2.05, ago90: 1.95, up30: 5, down30: 1 },
  ],
  rating_changes: [
    { date: '2026-05-01', firm: 'Goldman Sachs', from_grade: 'Neutral', to_grade: 'Buy', action: 'up' },
  ],
}

vi.mock('../hooks/useEstimates', () => ({ default: () => ({ data, isLoading: false }) }))

import EstimatesTab from './EstimatesTab'

describe('EstimatesTab', () => {
  it('renders forward estimates, revisions, and rating changes', () => {
    render(<EstimatesTab sym="AAPL" />)
    expect(screen.getByText('Forward estimates (analyst consensus)')).toBeInTheDocument()
    expect(screen.getByText('+15.0%')).toBeInTheDocument()      // eps growth
    expect(screen.getByText('$95.00B')).toBeInTheDocument()     // revenue avg
    expect(screen.getByText('Goldman Sachs')).toBeInTheDocument()
    expect(screen.getByText('Buy')).toBeInTheDocument()         // to_grade
  })
})

describe('EstimatesTab -- S8/S11 vertical slice (owner authorization, 2026-09-03)', () => {
  it('composes Provenance + FreshnessBadge on the consensus and price-target cards from D1 meta', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useEstimates', () => ({
      default: () => ({
        data: {
          sym: 'AAPL',
          entity: { status: 'resolved', entityId: 'e_aapl' },
          forward: [], revisions: [], rating_changes: [],
          consensus: {
            strongBuy: 1, buy: 69, hold: 34, sell: 7, strongSell: 0, total: 111, label: 'Buy',
            _meta: {
              vendor: 'fmp', sourceActivity: 'fmp_client.get_grades_consensus',
              sourceObservedAt: 1735689600, tieBreak: null, freshnessClass: 'end_of_day',
              licensingClass: 'R', degraded: null,
            },
          },
          price_target: {
            high: 400, low: 253, median: 325, consensus: 327,
            last_month: { count: 4, avg: 337.5 }, last_quarter: { count: 14, avg: 326.86 }, last_year: { count: 60, avg: 299.43 },
            _meta: {
              vendor: 'fmp', sourceActivity: 'fmp_client.get_price_target_consensus',
              sourceObservedAt: 1735689600, tieBreak: null, freshnessClass: 'end_of_day',
              licensingClass: 'R', degraded: null,
            },
          },
        },
        isLoading: false,
      }),
    }))
    const { default: FreshEstimatesTab } = await import('./EstimatesTab')
    render(<FreshEstimatesTab sym="AAPL" />)

    const toggles = screen.getAllByTestId('provenance-detail-toggle')
    expect(toggles).toHaveLength(2)   // one per card
    expect(screen.getAllByText('FMP')).toHaveLength(2)
    expect(screen.queryByTestId('entity-unresolved-note')).not.toBeInTheDocument()
  })

  it('renders an honest note when the symbol has not resolved to a canonical entity', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useEstimates', () => ({
      default: () => ({
        data: {
          sym: 'ZZZ', entity: { status: 'not_found', entityId: null },
          forward: [], revisions: [], rating_changes: [], consensus: null, price_target: null,
        },
        isLoading: false,
      }),
    }))
    const { default: FreshEstimatesTab } = await import('./EstimatesTab')
    render(<FreshEstimatesTab sym="ZZZ" />)
    expect(screen.getByTestId('entity-unresolved-note')).toHaveTextContent('not_found')
  })

  it('a degraded-but-usable consensus reads as entitlement-denied, not a silent normal render', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useEstimates', () => ({
      default: () => ({
        data: {
          sym: 'AAPL', entity: { status: 'resolved', entityId: 'e_aapl' },
          forward: [], revisions: [], rating_changes: [],
          consensus: {
            strongBuy: 1, buy: 2, hold: 0, sell: 0, strongSell: 0, total: 3, label: 'Buy',
            _meta: { vendor: 'fmp', sourceActivity: 'fmp_client.get_grades_consensus', sourceObservedAt: null, tieBreak: null, freshnessClass: 'stale', licensingClass: 'R', degraded: 'cached_forbidden' },
          },
          price_target: null,
        },
        isLoading: false,
      }),
    }))
    const { default: FreshEstimatesTab } = await import('./EstimatesTab')
    render(<FreshEstimatesTab sym="AAPL" />)
    const unavailable = screen.getByTestId('provenance-unavailable')
    expect(unavailable).toHaveAttribute('data-availability', 'entitlement_denied')
    // the headline card content still renders -- degraded is a trust fact,
    // not a reason to hide the analyst-count/label the backend DID return
    expect(screen.getByText('3 analysts')).toBeInTheDocument()
  })
})
