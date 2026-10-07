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

  // Lane FIN-A11Y round 2: the card used to BE the control (`role="button"`, tabIndex 0) with
  // the chip and Edit/Close/Delete inside it. Interactive content inside a button is one
  // control to a screen reader. The card is a named group now and its primary action is a real
  // <button> on the title; these two tests assert the same Seam promise (a keyboard member can
  // open a position) against that button. Nesting is railed in PositionsTable.nesting.test.jsx.
  it('the card has a real button for its primary action, and it opens the same TickerPopup a tap does (Seam)', () => {
    render(
      <PositionsTable positions={positions} prices={prices} accountSize={10000}
                      visibleColumns={POSITIONS_COLUMNS} />,
    )
    const card = screen.getByTestId('position-card')
    expect(card).toHaveAttribute('role', 'group')
    const open = screen.getByRole('button', { name: /AAPL position — open chart, research, and actions/ })
    expect(open.tagName).toBe('BUTTON')          // native: Enter and Space activate it for free
    expect(card.contains(open)).toBe(true)

    expect(screen.queryByTestId('chart-modal-AAPL')).not.toBeInTheDocument()
    fireEvent.click(open)
    expect(screen.getByTestId('chart-modal-AAPL')).toBeInTheDocument()
  })

  it('activating the title button opens the popup exactly once', () => {
    render(
      <PositionsTable positions={positions} prices={prices} accountSize={10000}
                      visibleColumns={POSITIONS_COLUMNS} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /AAPL position — open chart/ }))
    expect(screen.getAllByTestId('chart-modal-AAPL')).toHaveLength(1)
  })

  it('Enter on the card while an action button has focus does not double-fire', () => {
    render(
      <PositionsTable positions={positions} prices={prices} accountSize={10000}
                      visibleColumns={POSITIONS_COLUMNS} onEdit={vi.fn()} />,
    )
    const editBtn = screen.getByRole('button', { name: 'Edit AAPL' })
    fireEvent.keyDown(editBtn, { key: 'Enter', bubbles: true })
    expect(screen.queryByTestId('chart-modal-AAPL')).not.toBeInTheDocument()
  })
})
