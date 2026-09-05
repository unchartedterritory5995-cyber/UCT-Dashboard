// Phone card view: ≤640px renders cards (not the dense table).
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PositionsTable, { POSITIONS_COLUMNS } from './PositionsTable'

vi.mock('../../../hooks/useBreakpoint', () => ({ useIsPhone: () => true }))
// Same open-tracking stub as PositionsTable.test.jsx (Part A2 card click-through).
vi.mock('../../../components/TickerPopup', () => ({
  default: ({ sym, as: Tag = 'span', children }) => {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Tag data-testid={`ticker-popup-${sym}`} onClick={() => setOpen(true)}>{children}</Tag>
        {open && <div data-testid={`chart-modal-${sym}`}>chart modal for {sym}</div>}
      </>
    )
  },
}))

const positions = [
  {
    id: 1, symbol: 'AAPL', side: 'Long', shares: 10, entryPrice: 100,
    stopPrice: 95, entryDate: '2026-06-01',
  },
]
const prices = { AAPL: { price: 110, change_pct: 2 } }

describe('PositionsTable phone cards', () => {
  it('renders cards instead of a table', () => {
    render(
      <PositionsTable positions={positions} prices={prices} accountSize={10000}
                      visibleColumns={POSITIONS_COLUMNS} />,
    )
    expect(screen.getByTestId('position-card')).toBeInTheDocument()
    expect(document.querySelector('table')).toBeNull()
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('$110.00')).toBeInTheDocument()
    expect(screen.getByText(/\+\$100\.00/)).toBeInTheDocument()   // (110-100)×10
  })

  it('card actions fire the callbacks', () => {
    const onEdit = vi.fn()
    const onClose = vi.fn()
    const onDelete = vi.fn()
    render(
      <PositionsTable positions={positions} prices={prices} accountSize={10000}
                      visibleColumns={POSITIONS_COLUMNS}
                      onEdit={onEdit} onClose={onClose} onDelete={onDelete} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit AAPL' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close AAPL' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete AAPL' }))
    expect(onEdit).toHaveBeenCalledWith(positions[0])
    expect(onClose).toHaveBeenCalledWith(positions[0])
    expect(onDelete).toHaveBeenCalledWith(positions[0])
  })

  it('option rows render a contract card with option actions', () => {
    const onOptionClose = vi.fn()
    const strategy = { id: 's9' }
    const optRow = {
      id: 9, isOption: true, symbol: 'CRWV Oct 16 $110C', side: 'Long Call',
      sideKind: 'long', underlying: 'CRWV', shares: 2, entryPrice: 2,
      optCurrent: 3, optMarketValue: 600, optPnlDollar: 200, optPnlPercent: 0.5,
      strategy,
    }
    render(
      <PositionsTable positions={[optRow]} prices={{}} accountSize={0}
                      visibleColumns={POSITIONS_COLUMNS} onOptionClose={onOptionClose} />,
    )
    expect(screen.getByText('CRWV Oct 16 $110C')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Close CRWV/ }))
    expect(onOptionClose).toHaveBeenCalledWith(strategy)
  })

  it('clicking anywhere on the card opens the same TickerPopup as the chart-icon button (Part A2)', () => {
    render(
      <PositionsTable positions={positions} prices={prices} accountSize={10000}
                      visibleColumns={POSITIONS_COLUMNS} />,
    )
    expect(screen.queryByTestId('chart-modal-AAPL')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('AAPL'))
    expect(screen.getByTestId('chart-modal-AAPL')).toBeInTheDocument()
  })

  it('clicking Edit on the card does not also open the chart popup', () => {
    const onEdit = vi.fn()
    render(
      <PositionsTable positions={positions} prices={prices} accountSize={10000}
                      visibleColumns={POSITIONS_COLUMNS} onEdit={onEdit} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Edit AAPL' }))
    expect(onEdit).toHaveBeenCalled()
    expect(screen.queryByTestId('chart-modal-AAPL')).not.toBeInTheDocument()
  })
})
