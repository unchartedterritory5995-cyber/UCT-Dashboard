// Phone card view: ≤640px renders trade cards; setup select is desktop-only.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TradesTable, { buildTradesColumns } from './TradesTable'

vi.mock('../../../hooks/useBreakpoint', () => ({ useIsPhone: () => true }))

const trades = [
  {
    id: 't1', symbol: 'AAPL', side: 'Long', result: 'Win', shares: 10,
    entryPrice: 100, exitPrice: 110, entryDate: '2026-06-01', exitDate: '2026-06-10',
    pnlDollar: 100, pnlDollarNet: 98, pnlPercent: 0.1, rMultiple: 2.0,
    holdDays: 9, setup: 'VCP',
  },
]

describe('TradesTable phone cards', () => {
  it('renders cards with net P&L, R, prices and setup chip — no table, no select', () => {
    render(<TradesTable trades={trades} visibleColumns={buildTradesColumns()}
                        setups={['VCP']} onUpdateSetup={vi.fn()} />)
    expect(screen.getByTestId('trade-card')).toBeInTheDocument()
    expect(document.querySelector('table')).toBeNull()
    expect(document.querySelector('select')).toBeNull()          // desktop-only editing
    expect(screen.getByText('+$98.00')).toBeInTheDocument()
    expect(screen.getByText('+2.0R')).toBeInTheDocument()
    expect(screen.getByText(/100\.00.*110\.00/)).toBeInTheDocument()
    expect(screen.getByText('VCP')).toBeInTheDocument()
  })

  it('tapping a card opens the trade drawer', () => {
    const onRowAction = vi.fn()
    render(<TradesTable trades={trades} visibleColumns={buildTradesColumns()}
                        onRowAction={onRowAction} />)
    fireEvent.click(screen.getByTestId('trade-card'))
    expect(onRowAction).toHaveBeenCalledWith('open', trades[0])
  })
})
