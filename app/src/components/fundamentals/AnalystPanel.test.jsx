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

test('renders price target range bar with current-price marker', () => {
  mockData.mockReturnValue({
    ticker: 'AAPL',
    consensus: null,
    price_target: { low: 253, avg: 327, high: 400, current: 310, upside_pct: 5.5, count: 3, updated: '2026-07-08' },
    recent_actions: [],
  })
  const { container } = render(<AnalystPanel sym="AAPL" />)
  expect(container.querySelector('[class*="ptTrack"]')).toBeInTheDocument()
  expect(container.querySelector('[class*="ptCurrent"]')).toBeInTheDocument()
  expect(screen.getByText(/3 analysts/)).toBeInTheDocument()
  expect(screen.getByText(/as of 2026-07-08/)).toBeInTheDocument()
})

test('reiterate action row links to the source article', () => {
  mockData.mockReturnValue({
    ticker: 'AAPL',
    consensus: null,
    price_target: null,
    recent_actions: [{
      date: '2026-07-08', firm: 'Evercore ISI', action: 'hold',
      from_grade: 'Outperform', to_grade: 'Outperform', price_target: null,
      news_url: 'https://thefly.com/ajax/news_get.php?id=4381545', news_publisher: 'TheFly',
    }],
  })
  render(<AnalystPanel sym="AAPL" />)
  expect(screen.getByText('Reiterated')).toBeInTheDocument()
  const link = screen.getByText('Evercore ISI').closest('a')
  expect(link).toHaveAttribute('href', 'https://thefly.com/ajax/news_get.php?id=4381545')
})

test('downgrade action row has no link when news_url is absent', () => {
  mockData.mockReturnValue({
    ticker: 'AAPL',
    consensus: null,
    price_target: null,
    recent_actions: [{
      date: '2026-06-01', firm: 'Barclays', action: 'downgrade',
      from_grade: 'Overweight', to_grade: 'Equal-Weight', price_target: null,
      news_url: null, news_publisher: null,
    }],
  })
  render(<AnalystPanel sym="AAPL" />)
  expect(screen.getByText('Downgrade')).toBeInTheDocument()
  expect(screen.getByText('Barclays').closest('a')).toBeNull()
})

test('loading state renders a skeleton, not literal text', () => {
  mockData.mockReturnValue(undefined)
  const { container } = render(<AnalystPanel sym="AAPL" />)
  expect(container.querySelector('[class*="skelRow"]')).toBeInTheDocument()
  expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
})
