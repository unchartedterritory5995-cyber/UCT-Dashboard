import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import FundamentalsWidget from './FundamentalsWidget'

const mockData = vi.fn()
vi.mock('../../../hooks/useEarningsTable', () => ({
  default: () => ({ data: mockData() }),
}))

// Stateful wrapper that threads opts through onOptsChange, mirroring how the
// workspace persists per-widget opts — so a toggle click actually updates view.
function Wrap({ color = 'A', sym = 'AAPL', initialOpts = {}, onOpts }) {
  const [opts, setOpts] = useState(initialOpts)
  const groupSyms = { A: null, B: null, C: null, D: null, [color]: sym }
  const handle = (next) => { setOpts(next); onOpts?.(next) }
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym: () => {} }}>
      <FundamentalsWidget color={color} opts={opts} onOptsChange={handle} />
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

test('annual rows render newest-first (forward estimate at top)', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap />)
  const yearCells = screen.getAllByRole('cell').filter(c => /^20\d{2}( e)?$/.test(c.textContent))
  expect(yearCells[0]).toHaveTextContent('2026 e')   // forward estimate leads
  expect(yearCells[yearCells.length - 1]).toHaveTextContent('2024')  // oldest at bottom
})

test('toggling to Quarterly swaps the visible section and persists the choice', () => {
  mockData.mockReturnValue(FULL_DATA)
  const onOpts = vi.fn()
  render(<Wrap onOpts={onOpts} />)
  fireEvent.click(screen.getByRole('tab', { name: /quarterly/i }))
  expect(screen.getByText('2025 Q2')).toBeInTheDocument()
  expect(screen.queryByText('2024')).not.toBeInTheDocument()  // annual now hidden
  expect(onOpts).toHaveBeenCalledWith(expect.objectContaining({ view: 'quarterly' }))
})

test('restores the persisted view from opts (quarterly on first render)', () => {
  mockData.mockReturnValue(FULL_DATA)
  render(<Wrap initialOpts={{ view: 'quarterly' }} />)
  expect(screen.getByText('2025 Q2')).toBeInTheDocument()
  expect(screen.queryByText('2024')).not.toBeInTheDocument()
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
