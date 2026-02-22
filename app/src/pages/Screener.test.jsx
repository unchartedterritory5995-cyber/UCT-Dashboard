import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: [
      { ticker: 'NVDA', rs_score: 95.5, vol_ratio: 2.3, momentum: 88.1, cap_tier: 'LARGE' },
      { ticker: 'META', rs_score: 92.0, vol_ratio: 1.8, momentum: 85.0, cap_tier: 'LARGE' }
    ],
    mutate: vi.fn()
  }))
}))

import Screener from './Screener'

test('renders screener heading', () => {
  render(<Screener />)
  expect(screen.getByRole('heading', { name: /screener/i })).toBeInTheDocument()
})

test('renders ticker rows', () => {
  render(<Screener />)
  expect(screen.getByText('NVDA')).toBeInTheDocument()
  expect(screen.getByText('META')).toBeInTheDocument()
})

test('renders refresh button', () => {
  render(<Screener />)
  expect(screen.getByText('Refresh')).toBeInTheDocument()
})
