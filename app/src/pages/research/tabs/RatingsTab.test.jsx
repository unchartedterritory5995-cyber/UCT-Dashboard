import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const data = {
  sym: 'AAPL',
  composite: 91,
  components: { eps: 90, rs: 88, growth: 80, value: 41, smr: 'A', accdis: 'B', sponsorship: 'A' },
  checkup: [
    { label: 'EPS growth ≥ 25%', status: 'pass', value: '+30%' },
    { label: 'Debt/equity < 1.5x', status: 'fail', value: '2.10x' },
  ],
  method: 'Threshold-calibrated v1 — absolute scoring.',
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
  })
})
