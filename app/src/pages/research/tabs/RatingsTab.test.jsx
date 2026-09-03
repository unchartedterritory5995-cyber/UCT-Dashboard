import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const data = {
  sym: 'AAPL',
  entity: { status: 'resolved', entityId: 'em_aapl' },
  composite: 91,
  components: { eps: 90, rs: 88, growth: 80, value: 41, smr: 'A', accdis: 'B', sponsorship: 'A' },
  checkup: [
    { label: 'EPS growth ≥ 25%', status: 'pass', value: '+30%' },
    { label: 'Debt/equity < 1.5x', status: 'fail', value: '2.10x' },
  ],
  method: 'Threshold-calibrated v1 — absolute scoring.',
  price_as_of: '2026-09-02',
}

vi.mock('../hooks/useRatings', () => ({ default: () => ({ data, isLoading: false }) }))

import RatingsTab from './RatingsTab'

describe('RatingsTab', () => {
  it('renders composite, components, and the stock checkup', () => {
    render(<RatingsTab sym="AAPL" />)
    expect(screen.getByText('91')).toBeInTheDocument()                 // composite
    expect(screen.getByText('UCT Composite Rating')).toBeInTheDocument()
    expect(screen.getByText('EPS Strength')).toBeInTheDocument()
    expect(screen.getByText('Relative Strength')).toBeInTheDocument()
    expect(screen.getByText('EPS growth ≥ 25%')).toBeInTheDocument()
    expect(screen.getByText('+30%')).toBeInTheDocument()
    expect(screen.getByText(/Threshold-calibrated/)).toBeInTheDocument()
    // A resolved entity shows no unresolved-identity note.
    expect(screen.queryByTestId('entity-unresolved-note')).toBeNull()
  })

  it('discloses the price leg\'s as-of date, never a provider badge', () => {
    render(<RatingsTab sym="AAPL" />)
    expect(screen.getByText(/price data as of 2026-09-02/)).toBeInTheDocument()
    // This is a UCT-derived composite — no source/vendor "Provenance" chip.
    expect(screen.queryByText('FMP')).toBeNull()
  })

  it('shows an entity-unresolved note when Entity Master has not linked the symbol', () => {
    data.entity = { status: 'ambiguous', entityId: null }
    render(<RatingsTab sym="AAPL" />)
    expect(screen.getByTestId('entity-unresolved-note')).toHaveTextContent('ambiguous')
    data.entity = { status: 'resolved', entityId: 'em_aapl' }
  })
})
