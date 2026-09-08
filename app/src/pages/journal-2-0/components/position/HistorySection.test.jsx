import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import HistorySection from './HistorySection'

// Seam 11 (Position <-> Related Trades, 2026-09-06): HistorySection already
// implements ACCOUNT + SECURITY TRADE HISTORY correctly for every trade
// source (manual/broker/CSV) via symbol matching on an already
// account-scoped `trades` list -- it never reads position_id, which is a
// structurally random, inert sentinel for broker/CSV rows (trades.py::
// bulk_insert_trades). This file pins that shape plus the honest-labeling
// fix: the caption must never imply exact position lineage.

describe('HistorySection -- honest labeling (Seam 11)', () => {
  it('the caption never claims these are "the trades that created this position"', () => {
    render(<HistorySection trades={[]} positions={[{ id: 'p1', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' }]} />)
    expect(screen.getByText(/trade history for this security in this account/i)).toBeInTheDocument()
    expect(screen.queryByText(/trades that (created|opened|closed) this position/i)).not.toBeInTheDocument()
  })

  it('the section title stays "History" (unchanged) -- the caption carries the honesty fix, not the title', () => {
    render(<HistorySection trades={[]} positions={[{ id: 'p1', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' }]} />)
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
  })
})

describe('HistorySection -- symbol-scoped, never position_id-scoped (Seam 11)', () => {
  it('renders a closed trade whose position_id is a broker-sync sentinel that matches NO real position -- proving the view is symbol-scoped, not linked via the broken position_id', () => {
    const brokerTrade = {
      id: 't-broker-1',
      positionId: 'manual-9f3a2b7c-broker-sentinel-does-not-match-anything',
      symbol: 'AAPL',
      side: 'Long',
      shares: 5,
      entryPrice: 90,
      exitPrice: 95,
      entryDate: '2026-05-01',
      exitDate: '2026-05-10',
      pnlDollar: 25,
    }
    render(<HistorySection trades={[brokerTrade]} positions={[]} />)
    expect(screen.getByText(/90\.00.*95\.00/)).toBeInTheDocument()
  })

  it('renders trades from BOTH a still-open lifecycle and a fully-closed-and-reopened prior lifecycle of the same symbol together -- exactly what the caption discloses', () => {
    const priorLifecycleTrade = {
      id: 't-old-cycle', symbol: 'AAPL', side: 'Long', shares: 3,
      entryPrice: 80, exitPrice: 85, entryDate: '2026-03-01', exitDate: '2026-03-05', pnlDollar: 15,
    }
    const currentOpen = { id: 'p-current', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' }
    render(<HistorySection trades={[priorLifecycleTrade]} positions={[currentOpen]} />)
    expect(screen.getByText('OPEN')).toBeInTheDocument()
    expect(screen.getByText(/80\.00.*85\.00/)).toBeInTheDocument()
  })
})

describe('HistorySection -- unchanged behavior', () => {
  it('returns null when there is nothing to show', () => {
    const { container } = render(<HistorySection trades={[]} positions={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('clicking a closed trade still fires onRowAction with the real trade object', () => {
    const onRowAction = vi.fn()
    const trade = {
      id: 't1', symbol: 'AAPL', side: 'Long', shares: 5, entryPrice: 90, exitPrice: 95,
      entryDate: '2026-05-01', exitDate: '2026-05-10', pnlDollar: 25,
    }
    render(<HistorySection trades={[trade]} positions={[]} onRowAction={onRowAction} />)
    fireEvent.click(screen.getByText(/90\.00.*95\.00/))
    expect(onRowAction).toHaveBeenCalledWith('open', trade)
  })

  it('the OPEN row is never clickable', () => {
    const onRowAction = vi.fn()
    render(<HistorySection trades={[]} positions={[{ id: 'p1', side: 'Long', shares: 10, entryPrice: 100, entryDate: '2026-06-01' }]} onRowAction={onRowAction} />)
    fireEvent.click(screen.getByText('OPEN'))
    expect(onRowAction).not.toHaveBeenCalled()
  })
})
