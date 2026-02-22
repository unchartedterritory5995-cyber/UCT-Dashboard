import { render, screen } from '@testing-library/react'
import MarketBreadth from './MarketBreadth'

const mockData = {
  pct_above_50ma: 62.4,
  pct_above_200ma: 55.1,
  advancing: 227,
  declining: 148,
  distribution_days: 7,
  market_phase: 'Confirmed Uptrend'
}

test('renders distribution days', () => {
  render(<MarketBreadth data={mockData} />)
  expect(screen.getByText(/distribution days/i)).toBeInTheDocument()
  expect(screen.getByText('7')).toBeInTheDocument()
})

test('renders advancing and declining counts', () => {
  render(<MarketBreadth data={mockData} />)
  expect(screen.getByText('227')).toBeInTheDocument()
  expect(screen.getByText('148')).toBeInTheDocument()
})

test('renders MA percentages', () => {
  render(<MarketBreadth data={mockData} />)
  expect(screen.getByText(/62\.4/)).toBeInTheDocument()
  expect(screen.getByText(/55\.1/)).toBeInTheDocument()
})

test('renders loading when no data', () => {
  render(<MarketBreadth data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})
