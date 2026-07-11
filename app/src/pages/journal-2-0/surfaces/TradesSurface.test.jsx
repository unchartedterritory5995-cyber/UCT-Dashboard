/**
 * TradesSurface — Open Positions | Closed Trades | All segment toggle.
 *
 * The two existing tabs are NOT merged; the segment toggle picks which renders.
 * B5 adds the `All` segment, which (for v1) renders the SAME paginated closed-
 * trades list as `Closed Trades` (the true open+closed union is deferred). The
 * two heavy tabs are stubbed — the point is the surface's segment wiring +
 * `?seg=` persistence, not the tabs' internals.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useSearchParams } from 'react-router-dom'
import TradesSurface from './TradesSurface'

vi.mock('../tabs/OpenPositionsTab', () => ({
  default: () => <div data-testid="open-tab">open positions</div>,
}))
vi.mock('../tabs/TradeJournalTab', () => ({
  default: () => <div data-testid="closed-tab">closed trades</div>,
}))

// Surfaces the live `?seg=` so persistence is assertable.
function SegProbe() {
  const [params] = useSearchParams()
  return <div data-testid="seg-probe">{params.get('seg') || 'none'}</div>
}

function renderSurface(route = '/journal') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SegProbe />
      <TradesSurface />
    </MemoryRouter>,
  )
}

describe('TradesSurface — segment toggle', () => {
  it('renders all three segment tabs', () => {
    renderSurface()
    expect(screen.getByRole('tab', { name: 'Open Positions' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Closed Trades' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument()
  })

  it('defaults to Open Positions (no ?seg)', () => {
    renderSurface('/journal')
    expect(screen.getByTestId('open-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('closed-tab')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Open Positions' })).toHaveAttribute('aria-selected', 'true')
  })

  it('?seg=closed renders the closed-trades table', () => {
    renderSurface('/journal?seg=closed')
    expect(screen.getByTestId('closed-tab')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Closed Trades' })).toHaveAttribute('aria-selected', 'true')
  })

  it('?seg=all renders the closed-trades table (All == closed list for v1)', () => {
    renderSurface('/journal?seg=all')
    expect(screen.getByTestId('closed-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('open-tab')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
  })

  it('selecting All shows the closed-trades table and persists via ?seg=all', async () => {
    const user = userEvent.setup()
    renderSurface('/journal')
    await user.click(screen.getByRole('tab', { name: 'All' }))
    expect(screen.getByTestId('closed-tab')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    // segment persists in the URL (deep-link + back/forward survive)
    expect(screen.getByTestId('seg-probe')).toHaveTextContent('all')
  })

  it('selecting Open clears ?seg back to the default', async () => {
    const user = userEvent.setup()
    renderSurface('/journal?seg=all')
    await user.click(screen.getByRole('tab', { name: 'Open Positions' }))
    expect(screen.getByTestId('open-tab')).toBeInTheDocument()
    expect(screen.getByTestId('seg-probe')).toHaveTextContent('none')
  })
})
