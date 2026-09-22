import { render, screen } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Packet L CP1 (signed 2026-09-22, fingerprint ddcad5b0c).

let mockData = null
let mockIsLoading = false
vi.mock('swr', () => ({ default: () => ({ data: mockData, isLoading: mockIsLoading }) }))
vi.mock('../components/TickerPopup', () => ({
  default: ({ sym, children }) => <span data-ticker={sym}>{children}</span>,
}))

import OpenFlow from './OpenFlow'

beforeEach(() => {
  mockIsLoading = false
  mockData = {
    ok: true,
    rows: [
      { sym: 'NVDA', bull: 500000, bear: 50000, net: 450000, bullPct: 0.91, cp: 'C', strike: 900, exp: '2026-11-20', since: '2026-09-01', perf: 12.5 },
      { sym: 'TSLA', bull: 20000, bear: 300000, net: -280000, bullPct: 0.06, cp: 'P', strike: 200, exp: '2026-10-16', since: '2026-09-05', perf: -4.2 },
    ],
    n_names: 2,
    open_contracts: 2,
    days: 60,
    cap: 'all',
  }
})

test('renders the board with real rows', () => {
  render(<OpenFlow />)
  expect(screen.getByText('NVDA')).toBeTruthy()
  expect(screen.getByText('TSLA')).toBeTruthy()
  expect(screen.getByText(/2 names/)).toBeTruthy()
})

test('a loading state with no data yet shows a loading message, not an empty table', () => {
  mockData = null
  mockIsLoading = true
  render(<OpenFlow />)
  expect(screen.getByText(/Loading the board/)).toBeTruthy()
})

test('an honest ok:false response renders a clear failure state, not a broken table', () => {
  mockData = { ok: false, rows: [] }
  render(<OpenFlow />)
  expect(screen.getByRole('alert')).toBeTruthy()
})

test('an empty rows array (real data, nothing open) renders a clear empty state', () => {
  mockData = { ok: true, rows: [], n_names: 0, open_contracts: 0 }
  render(<OpenFlow />)
  expect(screen.getByText('No names match.')).toBeTruthy()
})
