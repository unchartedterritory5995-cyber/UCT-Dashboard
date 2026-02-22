import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: [
      { ticker: 'NVDA', rs_score: 95.5, cap_tier: 'LARGE', thesis: 'AI infrastructure leader, base breakout' },
      { ticker: 'META', rs_score: 91.0, cap_tier: 'LARGE', thesis: 'Ad revenue acceleration, Stage 2 uptrend' },
    ],
    mutate: vi.fn()
  }))
}))

import UCT20 from './UCT20'

test('renders UCT 20 heading', () => {
  render(<UCT20 />)
  expect(screen.getByRole('heading', { name: /uct 20/i })).toBeInTheDocument()
})

test('renders stock tickers', () => {
  render(<UCT20 />)
  expect(screen.getByText('NVDA')).toBeInTheDocument()
  expect(screen.getByText('META')).toBeInTheDocument()
})

test('renders thesis text', () => {
  render(<UCT20 />)
  expect(screen.getByText(/AI infrastructure leader/)).toBeInTheDocument()
})

test('renders rank numbers', () => {
  render(<UCT20 />)
  expect(screen.getByText('#1')).toBeInTheDocument()
  expect(screen.getByText('#2')).toBeInTheDocument()
})
