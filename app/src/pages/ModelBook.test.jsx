import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: [
      { id: 1, sym: 'NVDA', entry: 880.0, stop: 850.0, target: 960.0, size_pct: 5.0, status: 'open' }
    ],
    mutate: vi.fn()
  }))
}))

import ModelBook from './ModelBook'

test('renders model book heading', () => {
  render(<ModelBook />)
  expect(screen.getByText(/model book/i)).toBeInTheDocument()
})

test('renders trade row', () => {
  render(<ModelBook />)
  expect(screen.getByText('NVDA')).toBeInTheDocument()
})

test('renders add trade button', () => {
  render(<ModelBook />)
  expect(screen.getByText(/\+ add trade/i)).toBeInTheDocument()
})
