import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: null }))
}))

import PostMarket from './PostMarket'

test('renders post market heading', () => {
  render(<PostMarket />)
  expect(screen.getByRole('heading', { name: /post market/i })).toBeInTheDocument()
})

test('renders placeholder when no data', () => {
  render(<PostMarket />)
  expect(screen.getByText(/check back after the session ends/i)).toBeInTheDocument()
})
