import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TradesTable, { buildTradesColumns } from './TradesTable'

const BASE_TRADE = {
  id: 't1',
  userId: 'u1',
  positionId: 'p1',
  symbol: 'YSS',
  side: 'Long',
  shares: 100,
  entryPrice: 29.57,
  entryDate: '2026-04-09T00:00:00Z',
  exitPrice: 34.5,
  exitDate: '2026-04-10T00:00:00Z',
  originalStop: 27.9,
  setup: 'VCP',
  notes: null,
  pnlDollar: 493.0,
  pnlPercent: 0.166723,
  rMultiple: 2.9521,
  holdDays: 1,
  result: 'Win',
  createdAt: '2026-04-10T00:00:00Z',
}

describe('TradesTable — YSS reference render (§11.3)', () => {
  it('renders empty state', () => {
    const cols = buildTradesColumns().filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[]} visibleColumns={cols} />)
    expect(screen.getByText('No trades yet.')).toBeInTheDocument()
  })

  it('renders YSS trade row with Win badge', () => {
    const cols = buildTradesColumns().filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[BASE_TRADE]} visibleColumns={cols} />)
    expect(screen.getByText('YSS')).toBeInTheDocument()
    expect(screen.getByText('Win')).toBeInTheDocument()
  })

  it('renders P&L +$493.00 and R +3.0R', () => {
    const cols = buildTradesColumns().filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[BASE_TRADE]} visibleColumns={cols} />)
    expect(screen.getByText('+$493.00')).toBeInTheDocument()
    expect(screen.getByText('+3.0R')).toBeInTheDocument()
  })

  it('Stop column is hiddenByDefault', () => {
    const cols = buildTradesColumns()
    const stop = cols.find((c) => c.key === 'originalStop')
    expect(stop.hiddenByDefault).toBe(true)
  })

  it('sorts by entry date DESC (newest first)', () => {
    const older = { ...BASE_TRADE, id: 'a', symbol: 'OLDER', entryDate: '2026-01-01T00:00:00Z' }
    const newer = { ...BASE_TRADE, id: 'b', symbol: 'NEWER', entryDate: '2026-06-01T00:00:00Z' }
    const cols = buildTradesColumns().filter((c) => !c.hiddenByDefault)
    render(<TradesTable trades={[older, newer]} visibleColumns={cols} />)
    const rows = screen.getAllByRole('row').slice(1)
    const firstSymbol = rows[0].querySelector('td')?.textContent
    expect(firstSymbol).toBe('NEWER')
  })
})
