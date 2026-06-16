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
