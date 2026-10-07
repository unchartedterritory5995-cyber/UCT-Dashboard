import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import OwnershipPanel from './OwnershipPanel'

const mockData = vi.fn()
const mockError = vi.fn(() => undefined)
const mockMutate = vi.fn()
vi.mock('../../hooks/useOwnership', () => ({ default: () => ({ data: mockData(), error: mockError(), mutate: mockMutate }) }))

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

// TERM-033: the hook now THROWS on a failed read. A failure with no earlier answer is an
// error with a Retry: not a loading state that never ends, and not a claim about the company.
test('TERM-033: a failed read says so, with a Retry', async () => {
  mockData.mockReturnValue(undefined)
  mockError.mockReturnValue(new Error('Request failed (502)'))
  render(<OwnershipPanel sym="AAPL" />)
  expect(screen.getByRole('alert').textContent).toMatch(/could not load ownership for AAPL/i)
  expect(screen.queryByText(/^no /i)).not.toBeInTheDocument()
  screen.getByRole('button', { name: 'Retry' }).click()
  expect(mockMutate).toHaveBeenCalled()
  mockError.mockReturnValue(undefined)
})

test('TERM-033 control: still loading (no error) is not an error', () => {
  mockData.mockReturnValue(undefined)
  mockError.mockReturnValue(undefined)
  render(<OwnershipPanel sym="AAPL" />)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
