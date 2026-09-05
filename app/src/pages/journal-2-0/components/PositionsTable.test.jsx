import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// TickerPopup pulls in AuthContext via useFlagged; stub it to a simple
// button for table-render tests. Integration with the real TickerPopup
// is exercised in the browser, not unit tests. The stub also tracks its
// own open state on click so row-click-through tests (Part A2) can assert
// the SAME trigger the chart-icon button uses gets clicked, without
// re-implementing TickerPopup's real modal.
vi.mock('../../../components/TickerPopup', () => ({
  default: ({ sym, as: Tag = 'span', className, children }) => {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Tag
          className={className}
          data-testid={`ticker-popup-${sym}`}
          onClick={() => setOpen(true)}
        >
          {children}
        </Tag>
        {open && <div data-testid={`chart-modal-${sym}`}>chart modal for {sym}</div>}
      </>
    )
  },
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

  it('falls back to the broker mark for Current + P&L when the live feed is quiet', () => {
    // Broker-imported position, no live price but a last-synced brokerPrice.
    // Entry 100 → mark 110 over 10 shares = Current $110.00, P&L +$100.00.
    const brokerPos = {
      ...YSS, id: 'brk-1', symbol: 'BRK', entryPrice: 100, stopPrice: 90,
      shares: 10, originalShares: 10, brokerPrice: 110, source: 'broker',
    }
    render(
      <PositionsTable
        positions={[brokerPos]}
        prices={{}}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.getByText('$110.00')).toBeInTheDocument()      // Current from broker mark
    expect(screen.getByText('+$100.00')).toBeInTheDocument()     // (110 − 100) × 10
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

describe('PositionsTable — sortable headers', () => {
  const firstSym = () =>
    screen.getAllByRole('row').slice(1)[0].querySelector('td')?.textContent

  it('sorts by P&L (biggest first), then toggles to smallest first', async () => {
    const user = userEvent.setup()
    const a = { ...YSS, id: 'a', symbol: 'AAA' }
    const b = { ...YSS, id: 'b', symbol: 'BBB' }
    const prices = { AAA: { price: 30 }, BBB: { price: 40 } }
    render(
      <PositionsTable
        positions={[a, b]}
        prices={prices}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'P&L $' }))
    expect(firstSym()).toBe('BBB')
    await user.click(screen.getByRole('button', { name: 'P&L $' }))
    expect(firstSym()).toBe('AAA')
  })

  it('toggles the Symbol column to descending on second click', async () => {
    const user = userEvent.setup()
    const positions = [
      { ...YSS, id: '1', symbol: 'AAA' },
      { ...YSS, id: '2', symbol: 'ZZZ' },
    ]
    render(
      <PositionsTable
        positions={positions}
        prices={{}}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(firstSym()).toBe('AAA')  // default symbol asc
    await user.click(screen.getByRole('button', { name: 'Symbol' }))
    expect(firstSym()).toBe('ZZZ')
  })

  it('does not render a sort button for the Actions column', () => {
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument()
  })
})

// ─── 🔴 THE OTHER SURFACE THAT HELD THE SECOND ANSWER ───────────────────────
//
// This tab asked `isBrokerPlaceholderStop`, which answers only "is this the
// broker's NOT-NULL seed". A MANUAL row created without a stop carries
// `stopPrice = 0.0` (positions.py seeds it, the column is NOT NULL), so it
// sailed through: this table rendered `stop $0.00` and booked the full notional
// as Risk $, while the dashboard cockpit — which had the rule — called the same
// position unstopped. The client held two answers about one position's
// protection. Both now ask `hasNoRealStop`.
describe('PositionsTable — a manual position with no stop', () => {
  const NO_STOP = {
    ...YSS, id: 'nostop-1', symbol: 'TSLA',
    shares: 100, entryPrice: 100, stopPrice: 0, source: 'manual',
  }

  it('blanks the stop column instead of rendering $0.00 as protection', () => {
    render(
      <PositionsTable
        positions={[NO_STOP]}
        prices={{ TSLA: { price: 110 } }}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.queryByText('$0.00'),
      'a $0.00 stop rendered as a real stop on the Positions tab').toBeNull()
  })

  it('blanks Risk $ instead of booking the entire notional', () => {
    render(
      <PositionsTable
        positions={[NO_STOP]}
        prices={{ TSLA: { price: 110 } }}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    // (entry 100 − stop 0) × 100 shares = $10,000 — the whole position.
    expect(screen.queryByText('$10,000.00'),
      'the full notional was booked as Risk $ because a 0 stop was treated as real')
      .toBeNull()
  })

  it('CONTROL: a REAL stop still renders its stop and its risk', () => {
    // Without this, the two assertions above are satisfied by a table that
    // blanks these columns for every position.
    render(
      <PositionsTable
        positions={[{ ...NO_STOP, stopPrice: 95 }]}
        prices={{ TSLA: { price: 110 } }}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.getByText('$95.00')).toBeInTheDocument()
    expect(screen.getByText('$500.00')).toBeInTheDocument()   // (100−95)×100
  })
})

// ─── Row click-through (Portfolio/Position Intelligence Convergence V1, Part A2) ───
// Table view previously had NO row click-through — only the chart-icon button
// opened TickerPopup. The whole row must now open the SAME TickerPopup, without
// breaking the icon's own click or the other action buttons.
describe('PositionsTable — row click-through opens the chart-icon TickerPopup', () => {
  it('clicking anywhere on the row opens the same TickerPopup the chart icon opens', async () => {
    const user = userEvent.setup()
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    expect(screen.queryByTestId('chart-modal-YSS')).not.toBeInTheDocument()
    // Click the Symbol cell — nowhere near the actions column.
    await user.click(screen.getByText('YSS'))
    expect(screen.getByTestId('chart-modal-YSS')).toBeInTheDocument()
  })

  it('the chart-icon button itself still opens the popup directly (regression)', async () => {
    const user = userEvent.setup()
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    await user.click(screen.getByTestId('ticker-popup-YSS'))
    expect(screen.getByTestId('chart-modal-YSS')).toBeInTheDocument()
  })

  it('clicking Edit/Close/Del does not also open the chart popup', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(
      <PositionsTable
        positions={[YSS]}
        prices={PRICES}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
        onEdit={onEdit}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Edit YSS' }))
    expect(onEdit).toHaveBeenCalledWith(YSS)
    expect(screen.queryByTestId('chart-modal-YSS')).not.toBeInTheDocument()
  })

  it('an option row\'s row-click opens TickerPopup on the underlying only (unchanged from icon-click)', async () => {
    const user = userEvent.setup()
    const optRow = {
      id: 9, isOption: true, symbol: 'CRWV Oct 16 $110C', side: 'Long Call',
      sideKind: 'long', underlying: 'CRWV', shares: 2, entryPrice: 2,
      optCurrent: 3, optMarketValue: 600, optPnlDollar: 200, optPnlPercent: 0.5,
      strategy: { id: 's9' },
    }
    render(
      <PositionsTable
        positions={[optRow]}
        prices={{}}
        accountSize={ACCOUNT}
        visibleColumns={POSITIONS_COLUMNS}
      />,
    )
    await user.click(screen.getByText('CRWV Oct 16 $110C'))
    expect(screen.getByTestId('chart-modal-CRWV')).toBeInTheDocument()
  })
})
