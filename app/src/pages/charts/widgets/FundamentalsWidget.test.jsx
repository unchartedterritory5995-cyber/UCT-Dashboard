import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import FundamentalsWidget from './FundamentalsWidget'

const mockData = vi.fn()
vi.mock('../../../hooks/useEarningsTable', () => ({
  default: () => ({ data: mockData() }),
}))

function Wrap({ color = 'A', sym = 'AAPL' }) {
  const groupSyms = { A: null, B: null, C: null, D: null, [color]: sym }
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym: () => {} }}>
      <FundamentalsWidget color={color} opts={{}} />
    </WorkspaceContext.Provider>
  )
}

test('renders annual rows and quarterly blocks', () => {
  mockData.mockReturnValue({
    ticker: 'AAPL',
    annual: [
      { year: 2024, eps: 2.37, eps_chg_pct: 45, sales: 6.0e9, sales_chg_pct: 12, estimate: false },
      { year: 2026, eps: 3.15, eps_chg_pct: 14, sales: 7.8e9, sales_chg_pct: 15, estimate: true, eps_revision: 'up' },
    ],
    quarterly: [
      { label: '2025 Q2', eps_actual: 0.64, eps_estimate: 0.57, eps_surprise_pct: 12, rev_actual: 1.63e9, rev_estimate: 1.43e9, rev_surprise_pct: 14, reported: true },
      { label: '2026 Q2', report_date: '2026-08-05', eps_estimate: 0.58, reported: false },
    ],
  })
  render(<Wrap />)
  expect(screen.getByText('2024')).toBeInTheDocument()
  expect(screen.getByText('2026 e')).toBeInTheDocument()   // estimate-year suffix
  expect(screen.getByText('2025 Q2')).toBeInTheDocument()
})

test('shows pick-a-ticker prompt when no symbol', () => {
  mockData.mockReturnValue(null)
  const groupSyms = { A: null, B: null, C: null, D: null }
  render(
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym: () => {} }}>
      <FundamentalsWidget color="A" opts={{}} />
    </WorkspaceContext.Provider>,
  )
  expect(screen.getByText(/pick a ticker/i)).toBeInTheDocument()
})

test('shows empty state when data has no rows', () => {
  mockData.mockReturnValue({ ticker: 'ZZ', annual: [], quarterly: [] })
  render(<Wrap sym="ZZ" />)
  expect(screen.getByText(/no fundamentals/i)).toBeInTheDocument()
})
