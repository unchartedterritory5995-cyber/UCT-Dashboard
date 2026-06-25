import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    // Now rendered in both "P&L $" (gross) and "Net P&L" columns
    expect(screen.getAllByText('+$493.00').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('+3.0R')).toBeInTheDocument()
  })

  it('Stop column is hiddenByDefault', () => {
    const cols = buildTradesColumns()
    const stop = cols.find((c) => c.key === 'originalStop')
    expect(stop.hiddenByDefault).toBe(true)
  })

  it('renders 🧭 indicator for trades with Compass post-mortems (P5-M)', () => {
    const cols = buildTradesColumns().filter((c) => !c.hiddenByDefault)
    const reviewed = new Set([BASE_TRADE.id])
    render(
      <TradesTable trades={[BASE_TRADE]} visibleColumns={cols} reviewedIds={reviewed} />,
    )
    expect(
      screen.getByLabelText('Compass post-mortem available'),
    ).toBeInTheDocument()
  })

  it('omits 🧭 indicator when trade has no review (P5-M)', () => {
    const cols = buildTradesColumns().filter((c) => !c.hiddenByDefault)
    const reviewed = new Set(['other-trade'])
    render(
      <TradesTable trades={[BASE_TRADE]} visibleColumns={cols} reviewedIds={reviewed} />,
    )
    expect(
      screen.queryByLabelText('Compass post-mortem available'),
    ).not.toBeInTheDocument()
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

describe('TradesTable — sortable headers', () => {
  const cols = () => buildTradesColumns().filter((c) => !c.hiddenByDefault)
  const firstRowSymbol = () =>
    screen.getAllByRole('row').slice(1)[0].querySelector('td')?.textContent

  it('clicking P&L sorts biggest-first, then toggles to smallest-first', async () => {
    const user = userEvent.setup()
    const small = { ...BASE_TRADE, id: 's', symbol: 'SMALL', pnlDollar: 50 }
    const big = { ...BASE_TRADE, id: 'g', symbol: 'BIG', pnlDollar: 900 }
    render(<TradesTable trades={[small, big]} visibleColumns={cols()} />)

    await user.click(screen.getByRole('button', { name: 'P&L $' }))
    expect(firstRowSymbol()).toBe('BIG')

    await user.click(screen.getByRole('button', { name: 'P&L $' }))
    expect(firstRowSymbol()).toBe('SMALL')
  })

  it('clicking Symbol sorts alphabetically (A→Z)', async () => {
    const user = userEvent.setup()
    const z = { ...BASE_TRADE, id: 'z', symbol: 'ZZZZ' }
    const a = { ...BASE_TRADE, id: 'a', symbol: 'AAAA' }
    render(<TradesTable trades={[z, a]} visibleColumns={cols()} />)

    await user.click(screen.getByRole('button', { name: 'Symbol' }))
    expect(firstRowSymbol()).toBe('AAAA')
  })

  it('marks the active column header with aria-sort', async () => {
    const user = userEvent.setup()
    render(<TradesTable trades={[BASE_TRADE]} visibleColumns={cols()} />)
    await user.click(screen.getByRole('button', { name: 'R' }))
    const rHeader = screen.getByRole('button', { name: 'R' }).closest('th')
    expect(rHeader).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts blank setups to the bottom regardless of direction', async () => {
    const user = userEvent.setup()
    const tagged = { ...BASE_TRADE, id: 'x', symbol: 'TAGGED', setup: 'VCP' }
    const blank = { ...BASE_TRADE, id: 'y', symbol: 'BLANK', setup: '' }
    render(<TradesTable trades={[blank, tagged]} visibleColumns={cols()} />)
    await user.click(screen.getByRole('button', { name: 'Setup' }))
    expect(firstRowSymbol()).toBe('TAGGED')
    await user.click(screen.getByRole('button', { name: 'Setup' }))
    // Even descending, the blank-setup row stays last.
    expect(firstRowSymbol()).toBe('TAGGED')
  })
})

describe('TradesTable — inline setup tagging', () => {
  const cols = () => buildTradesColumns().filter((c) => !c.hiddenByDefault)

  it('renders a setup dropdown for equity trades and saves the pick', async () => {
    const user = userEvent.setup()
    const onUpdateSetup = vi.fn()
    render(
      <TradesTable
        trades={[{ ...BASE_TRADE, setup: null }]}
        visibleColumns={cols()}
        setups={['VCP', 'Flag', 'EP']}
        onUpdateSetup={onUpdateSetup}
      />,
    )
    const sel = screen.getByLabelText('Setup for YSS')
    await user.selectOptions(sel, 'Flag')
    expect(onUpdateSetup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }), 'Flag',
    )
  })

  it('passes null when the setup is cleared', async () => {
    const user = userEvent.setup()
    const onUpdateSetup = vi.fn()
    render(
      <TradesTable
        trades={[{ ...BASE_TRADE, setup: 'VCP' }]}
        visibleColumns={cols()}
        setups={['VCP']}
        onUpdateSetup={onUpdateSetup}
      />,
    )
    await user.selectOptions(screen.getByLabelText('Setup for YSS'), '')
    expect(onUpdateSetup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }), null,
    )
  })

  it('keeps an existing setup not in the account list as a valid option', () => {
    render(
      <TradesTable
        trades={[{ ...BASE_TRADE, setup: 'Custom XYZ' }]}
        visibleColumns={cols()}
        setups={['VCP']}
        onUpdateSetup={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('Setup for YSS').value).toBe('Custom XYZ')
  })

  it('leaves option rows read-only (no dropdown)', () => {
    render(
      <TradesTable
        trades={[{ ...BASE_TRADE, isOption: true, setup: 'Long Call' }]}
        visibleColumns={cols()}
        setups={['VCP']}
        onUpdateSetup={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Setup for YSS')).not.toBeInTheDocument()
    expect(screen.getByText('Long Call')).toBeInTheDocument()
  })

  it('falls back to plain text when no onUpdateSetup is provided', () => {
    render(
      <TradesTable
        trades={[{ ...BASE_TRADE, setup: 'VCP' }]}
        visibleColumns={cols()}
      />,
    )
    expect(screen.queryByLabelText('Setup for YSS')).not.toBeInTheDocument()
    expect(screen.getByText('VCP')).toBeInTheDocument()
  })
})
