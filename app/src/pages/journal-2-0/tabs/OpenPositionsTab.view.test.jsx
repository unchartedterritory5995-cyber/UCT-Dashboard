// Focused view-toggle tests. Mock the heavy children — this only asserts
// which view renders and that the choice persists.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import OpenPositionsTab from './OpenPositionsTab'

vi.mock('../hooks/useJ2Positions', () => ({
  default: () => ({
    positions: [{ id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01', stopPrice: 95 }],
    isLoading: false, error: null, refresh: vi.fn(),
  }),
}))
vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({ strategies: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: { id: 'a1', name: 'Test' }, accounts: [] }),
}))
vi.mock('../hooks/useJ2Nudges', () => ({ default: () => ({ nudges: null }) }))
vi.mock('../hooks/useBrokerWarming', () => ({ default: () => ({ warming: false, broker: null }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: { AAPL: { price: 110, change_pct: 2 } }, isStreaming: false }),
}))
vi.mock('../components/BrokerAccountHero', () => ({ default: () => null }))
vi.mock('../components/BrokerSyncStatus', () => ({ default: () => null }))
vi.mock('../components/BrokerReviewNudge', () => ({ default: () => null }))
vi.mock('../components/NudgesBanner', () => ({ default: () => null }))
vi.mock('../components/HoldingsList', () => ({
  default: () => <div data-testid="holdings-list" />,
}))
vi.mock('../components/PositionsTable', () => ({
  default: () => <div data-testid="positions-table" />,
  POSITIONS_COLUMNS: [{ key: 'symbol', label: 'Symbol' }],
}))

beforeEach(() => localStorage.clear())

describe('OpenPositionsTab view toggle', () => {
  it('defaults to the RH holdings list', () => {
    render(<OpenPositionsTab settings={{}} />)
    expect(screen.getByTestId('holdings-list')).toBeInTheDocument()
    expect(screen.queryByTestId('positions-table')).toBeNull()
  })

  it('switches to the table and persists the choice', () => {
    render(<OpenPositionsTab settings={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByTestId('positions-table')).toBeInTheDocument()
    expect(localStorage.getItem('uct.j2.openPositions.view')).toBe('table')
  })

  it('restores a persisted table preference', () => {
    localStorage.setItem('uct.j2.openPositions.view', 'table')
    render(<OpenPositionsTab settings={{}} />)
    expect(screen.getByTestId('positions-table')).toBeInTheDocument()
  })

  it('shows the Columns button only in table view', () => {
    render(<OpenPositionsTab settings={{}} />)
    expect(screen.queryByRole('button', { name: /columns/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(screen.getByRole('button', { name: /columns/i })).toBeInTheDocument()
  })
})
