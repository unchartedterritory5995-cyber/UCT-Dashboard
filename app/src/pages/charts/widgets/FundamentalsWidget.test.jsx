import { render, screen, fireEvent } from '@testing-library/react'
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

const FULL_DATA = {
  ticker: 'AAPL',
  annual: [
    { year: 2024, eps: 2.37, eps_chg_pct: 45, sales: 6.0e9, sales_chg_pct: 12, estimate: false },
    { year: 2026, eps: 3.15, eps_chg_pct: 14, sales: 7.8e9, sales_chg_pct: 15, estimate: true, eps_revision: 'up' },
  ],
  quarterly: [
    { label: '2025 Q2', eps_actual: 0.64, eps_estimate: 0.57, eps_surprise_pct: 12, rev_actual: 1.63e9, rev_estimate: 1.43e9, rev_surprise_pct: 14, reported: true },
    { label: '2026 Q2', report_date: '2026-08-05', eps_estimate: 0.58, reported: false },
  ],
}

test('defaults to the annual view (quarterly hidden until toggled)', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap />)
  expect(screen.getByText('2024')).toBeInTheDocument()
  expect(screen.getByText('2026 e')).toBeInTheDocument()   // estimate-year suffix
  expect(screen.queryByText('2025 Q2')).not.toBeInTheDocument()
})

test('toggling to Quarterly swaps the visible section', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap />)
  fireEvent.click(screen.getByRole('tab', { name: /quarterly/i }))
  expect(screen.getByText('2025 Q2')).toBeInTheDocument()
  expect(screen.queryByText('2024')).not.toBeInTheDocument()  // annual now hidden
})

test('falls back to quarterly when no annual data exists', () => {
  mockData.mockReturnValue({ ...FULL_DATA, annual: [] })
  render(<Wrap />)
  // annual is the default but has no rows → effective view is quarterly
  expect(screen.getByText('2025 Q2')).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: /annual/i })).toBeDisabled()
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
