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

// 🔴 `/api/ownership/{sym}` became require_paid on 2026-08-09, and this panel is
// two clicks from the FREE Morning Wire page. Before the fix, `null` from the
// hook rendered "Loading NVDA…" — so a 402 was a spinner that never stopped.
test('a PAYWALL REFUSAL says so — it does not sit on "Loading…" forever', () => {
  mockData.mockReturnValue({ locked: true })
  render(<OwnershipPanel sym="NVDA" />)
  expect(screen.getByText(/paid plan/i)).toBeInTheDocument()
  expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
  // …and "we refused you" is not "the market has nothing here".
  expect(screen.queryByText(/no ownership data/i)).not.toBeInTheDocument()
})
