import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const data = {
  sym: 'AAPL',
  entity: { status: 'resolved', entityId: 'em_aapl' },
  institutional: {
    pct_held: 61.0,
    holders: [{ holder: 'Vanguard Group', shares: 1.3e9, pct_out: 8.5, value: 3.3e11, date: '2026-03-31' }],
  },
  short: { shares_short: 5e7, short_pct_float: 0.73, days_to_cover: 1.8, prior_month_short: 4.9e7 },
  share_counts: { float_shares: 6.8e9, shares_outstanding: 1.5e10, _meta: null },
  insider: [{ name: 'Tim Cook', title: 'CEO', type: 'sell', shares: 50000, amount: 1.3e7, date: '2026-05-01' }],
}

vi.mock('../hooks/useOwnership', () => ({ default: () => ({ data, isLoading: false }) }))

import OwnershipTab from './OwnershipTab'

describe('OwnershipTab', () => {
  it('renders institutional, short interest, share counts, and insider activity', () => {
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByText('61%')).toBeInTheDocument()         // pct held
    expect(screen.getByText('Vanguard Group')).toBeInTheDocument()
    expect(screen.getByText('0.73%')).toBeInTheDocument()       // short % float
    expect(screen.getByText('6.80B')).toBeInTheDocument()       // float shares, from share_counts
    expect(screen.getByText('Tim Cook · CEO')).toBeInTheDocument()
    expect(screen.getByText('sell')).toBeInTheDocument()
    // A resolved entity shows no unresolved-identity note.
    expect(screen.queryByTestId('entity-unresolved-note')).toBeNull()
  })

  it('shows an entity-unresolved note when Entity Master has not linked the symbol', () => {
    data.entity = { status: 'not_found', entityId: null }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByTestId('entity-unresolved-note')).toHaveTextContent('not_found')
    data.entity = { status: 'resolved', entityId: 'em_aapl' }
  })
})
