// app/src/pages/calendar/EarningsTile.test.jsx
// Seam 19 (2026-09-06): the Board view's hero tile gained a Ticker Actions
// door (Ask AI, Flag, Tag, Compare, Alert) on top of its existing tap-to-peek
// click. Whole-tile long-press/right-click, matching EarningsCard.jsx's own
// precedent for a compact-card shape (vs. the sym-span-scoped precedent used
// on dense multi-column rows like CalendarDayTable.jsx/WireView.jsx).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../components/ui/UIcon', () => ({ default: () => null }))

import EarningsTile from './EarningsTile'

const E = (sym, over = {}) => ({ sym, eps_est: null, eps_act: null, expected_move: null, ...over })

describe('EarningsTile', () => {
  it('renders the sym and fires onSelect on click', () => {
    const onSelect = vi.fn()
    render(<EarningsTile e={E('AAPL')} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('AAPL'))
    expect(onSelect).toHaveBeenCalled()
    expect(onSelect.mock.calls[0][0].sym).toBe('AAPL')
  })

  it('spreads longPressProps(sym) onto the whole tile when provided', () => {
    const longPressProps = vi.fn(() => ({ 'data-lp': 'yes' }))
    render(<EarningsTile e={E('AAPL')} onSelect={vi.fn()} longPressProps={longPressProps} />)
    expect(longPressProps).toHaveBeenCalledWith('AAPL')
    expect(screen.getByRole('button')).toHaveAttribute('data-lp', 'yes')
  })

  it('does not throw when longPressProps is omitted (defensive default for other/future callers)', () => {
    expect(() => render(<EarningsTile e={E('AAPL')} onSelect={vi.fn()} />)).not.toThrow()
  })

  it('click-to-peek is unaffected by the presence of longPressProps', () => {
    const onSelect = vi.fn()
    const longPressProps = vi.fn(() => ({}))
    render(<EarningsTile e={E('MSFT')} onSelect={onSelect} longPressProps={longPressProps} />)
    fireEvent.click(screen.getByText('MSFT'))
    expect(onSelect).toHaveBeenCalled()
    expect(onSelect.mock.calls[0][0].sym).toBe('MSFT')
  })
})
