import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// TickerPopup pulls in AuthContext via useFlagged; stub it to a simple
// button for table-render tests. Integration with the real TickerPopup
// is exercised in the browser, not unit tests.
vi.mock('../../../components/TickerPopup', () => ({
  default: ({ sym, as: Tag = 'span', className, children }) => (
    <Tag className={className} data-testid={`ticker-popup-${sym}`}>
      {children}
    </Tag>
  ),
}))

import PositionsTable, { POSITIONS_COLUMNS } from './PositionsTable'

// §14.7 YSS verification — this test anchors the visible UI against the
// same numbers the calculations module tests assert against. If PositionsTable
// ever renders something that disagrees with calculations.js, this breaks.

const YSS = {
  id: 'yss-1',
  userId: 'u1',
  symbol: 'YSS',
  side: 'Long',
  entryDate: '2026-04-09T00:00:00Z',
  shares: 250,
  originalShares: 250,
  entryPrice: 29.57,
  stopPrice: 27.9,
  breakevenStop: null,
  raiseToBreakeven: false,
  setup: null,
  notes: null,
  contextAtEntry: {},
  createdAt: '2026-04-09T00:00:00Z',
  updatedAt: '2026-04-09T00:00:00Z',
  closedAt: null,
}

const PRICES = { YSS: { price: 35.53 } }
const ACCOUNT = 100_000

describe('PositionsTable — YSS reference render (§14.7)', () => {
  it('renders the empty state when no positions', () => {
    render(
      <PositionsTable
        positions={[]}
        prices={{}}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.getByText('No open positions.')).toBeInTheDocument()
  })

  it('renders the symbol and LONG badge', () => {
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.getByText('YSS')).toBeInTheDocument()
    expect(screen.getByText('LONG')).toBeInTheDocument()
  })

  it('renders Risk $417.50 from the YSS reference', () => {
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.getByText('$417.50')).toBeInTheDocument()
  })

  it('renders Heat $1,907.50 from the YSS reference', () => {
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.getByText('$1,907.50')).toBeInTheDocument()
  })

  it('renders P&L +$1,490.00 (signed)', () => {
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.getByText('+$1,490.00')).toBeInTheDocument()
  })

  it('renders P&L % +20.16% (signed, 2 dp)', () => {
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.getByText('+20.16%')).toBeInTheDocument()
  })

  it('renders B/E Sell as "55 (22%)" (round, not ceil)', () => {
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    // Find the cell containing the B/E Sell value (the count "55" plus
    // the percent). The cell's combined text is "55 (22%)".
    const beSellCell = screen.getByText(/\(22%\)/i).closest('td')
    expect(beSellCell).toBeInTheDocument()
    expect(beSellCell.textContent).toMatch(/55\s*\(22%\)/)
  })

  it('renders — for Current when price is missing', () => {
    render(
      <PositionsTable
        positions={[YSS]}
        prices={{}}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    // Multiple — might appear (P&L, Current, etc.); ensure at least one
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThan(0)
  })

  it('hides non-visible columns', () => {
    const onlySymbolAndSide = POSITIONS_COLUMNS.filter((c) =>
      ['symbol', 'side', 'actions'].includes(c.key),
    )
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={onlySymbolAndSide}
      />,
    )
    // Risk column hidden → "$417.50" should not appear
    expect(screen.queryByText('$417.50')).not.toBeInTheDocument()
    // Symbol still renders
    expect(screen.getByText('YSS')).toBeInTheDocument()
  })

  it('sorts positions by symbol ascending', () => {
    const positions = [
      { ...YSS, id: '1', symbol: 'ZZZ' },
      { ...YSS, id: '2', symbol: 'AAA' },
      { ...YSS, id: '3', symbol: 'MMM' },
    ]
    render(
      <PositionsTable
        positions={positions}
        prices={{}}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    const symbols = screen.getAllByRole('row').slice(1).map((row) => {
      // first <td> is the symbol column
      return row.querySelector('td')?.textContent
    })
    expect(symbols).toEqual(['AAA', 'MMM', 'ZZZ'])
  })
})
