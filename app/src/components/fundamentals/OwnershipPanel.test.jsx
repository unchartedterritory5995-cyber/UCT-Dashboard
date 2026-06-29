import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import OwnershipPanel from './OwnershipPanel'

const mockData = vi.fn()
vi.mock('../../hooks/useOwnership', () => ({ default: () => ({ data: mockData() }) }))

test('renders inst %, a holder with a delta chip, and a buyer', () => {
  mockData.mockReturnValue({
    ticker: 'AAPL', inst_pct: 61.4, inst_holders_count: 5123, as_of: '2026-03-31',
    top_holders: [{ holder: 'Vanguard', shares: 1.31e9, pct_out: 8.4, value: 3.2e11, change: 'added', change_shares: 2.0e7 }],
    biggest_buyers: [{ holder: 'NewCo', change_shares: 5.0e8 }], biggest_sellers: [],
  })
  render(<OwnershipPanel sym="AAPL" />)
  expect(screen.getByText('Vanguard')).toBeInTheDocument()
  expect(screen.getByText('+ADD')).toBeInTheDocument()
  expect(screen.getByText('NewCo')).toBeInTheDocument()
})

test('empty state', () => {
  mockData.mockReturnValue({ ticker: 'ZZ', inst_pct: null, top_holders: [], biggest_buyers: [], biggest_sellers: [] })
  render(<OwnershipPanel sym="ZZ" />)
  expect(screen.getByText(/no ownership data/i)).toBeInTheDocument()
})
