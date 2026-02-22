import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({
    data: [
      { name: 'TSDR', color: '#2d8c4e', tickers: ['NVDA', 'META', 'AAPL'] },
      { name: 'Bracco', color: '#c9a84c', tickers: ['TSLA', 'AMZN'] }
    ]
  }))
}))

import Traders from './Traders'

test('renders traders heading', () => {
  render(<Traders />)
  expect(screen.getByText(/traders/i)).toBeInTheDocument()
})

test('renders trader cards', () => {
  render(<Traders />)
  expect(screen.getByText('TSDR')).toBeInTheDocument()
  expect(screen.getByText('Bracco')).toBeInTheDocument()
})

test('renders ticker links with finviz href', () => {
  render(<Traders />)
  const nvdaLink = screen.getByRole('link', { name: 'NVDA' })
  expect(nvdaLink).toBeInTheDocument()
  expect(nvdaLink).toHaveAttribute('href', expect.stringContaining('finviz.com'))
})
