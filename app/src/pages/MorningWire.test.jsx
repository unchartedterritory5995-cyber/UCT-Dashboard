import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn((key) => {
    if (key === '/api/rundown') return { data: { html: '<p data-testid="rundown-content">Test rundown</p>' } }
    if (key === '/api/breadth') return { data: { pct_above_50ma: 62.4, pct_above_200ma: 55.1, distribution_days: 3, market_phase: 'Confirmed Uptrend' } }
    if (key === '/api/earnings') return { data: { bmo: [{ sym: 'AAPL', eps_est: 2.50, eps_act: 2.60, surprise_pct: 4.0 }], amc: [] } }
    if (key === '/api/leadership') return { data: [{ sym: 'NVDA', thesis: 'AI infrastructure leader' }] }
    return { data: null }
  })
}))

import MorningWire from './MorningWire'

test('renders morning wire heading', () => {
  render(<MorningWire />)
  expect(screen.getByText(/morning wire/i)).toBeInTheDocument()
})

test('renders rundown HTML content', () => {
  render(<MorningWire />)
  expect(screen.getByTestId('rundown-content')).toBeInTheDocument()
})

test('renders earnings table', () => {
  render(<MorningWire />)
  expect(screen.getByText('AAPL')).toBeInTheDocument()
})

test('renders leadership section', () => {
  render(<MorningWire />)
  expect(screen.getByText('NVDA')).toBeInTheDocument()
})

test('renders breadth stats', () => {
  render(<MorningWire />)
  expect(screen.getByText('Confirmed Uptrend')).toBeInTheDocument()
})
