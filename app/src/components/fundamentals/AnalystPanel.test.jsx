import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import AnalystPanel from './AnalystPanel'

const mockData = vi.fn()
vi.mock('../../hooks/useAnalystIntel', () => ({ default: () => ({ data: mockData() }) }))

test('renders consensus, price target, and an upgrade action', () => {
  mockData.mockReturnValue({
    ticker: 'AAPL',
    consensus: { rating: 'Buy', buy: 28, hold: 9, sell: 2, strong_buy: 12, strong_sell: 0 },
    price_target: { low: 210, avg: 285, high: 320, current: 250, upside_pct: 14.0 },
    recent_actions: [{ date: '2026-06-20', firm: 'Morgan Stanley', action: 'upgrade', from_grade: 'Equal-Weight', to_grade: 'Overweight', price_target: 300 }],
  })
  render(<AnalystPanel sym="AAPL" />)
  expect(screen.getByText('Buy')).toBeInTheDocument()
  expect(screen.getByText(/\+14%/)).toBeInTheDocument()
  expect(screen.getByText('Morgan Stanley')).toBeInTheDocument()
})

test('empty state when no coverage', () => {
  mockData.mockReturnValue({ ticker: 'ZZ', consensus: null, price_target: null, recent_actions: [] })
  render(<AnalystPanel sym="ZZ" />)
  expect(screen.getByText(/no analyst coverage/i)).toBeInTheDocument()
})
