// app/src/pages/calendar/EarningsCard.test.jsx
// Unit tests for the REAL EarningsCard (not mocked).
//
// Regression target: EarningsCard renders {timing.toUpperCase()} — when a caller
// (e.g. MyStocksHub) forgot to pass `timing`, the whole route white-screened with
// "TypeError: Cannot read properties of undefined (reading 'toUpperCase')".
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Isolate EarningsCard from its heavy children.
vi.mock('../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ menu: null, openMenu: vi.fn(), closeMenu: vi.fn(), longPressProps: () => ({}) }),
}))

import EarningsCard from './EarningsCard'

describe('EarningsCard', () => {
  it('renders the timing pill in upper-case when timing is provided', () => {
    render(<EarningsCard entry={{ sym: 'AAPL', date: '2026-06-02' }} timing="bmo" />)
    expect(screen.getByText('AAPL')).toBeTruthy()
    // "BMO" shows in both the timing pill and the session label.
    expect(screen.getAllByText('BMO').length).toBeGreaterThan(0)
  })

  it('does not throw when timing is missing (defensive guard)', () => {
    // Before the guard this threw and crashed the route via the ErrorBoundary.
    expect(() =>
      render(<EarningsCard entry={{ sym: 'AAPL', date: '2026-06-02' }} />),
    ).not.toThrow()
    expect(screen.getByText('AAPL')).toBeTruthy()
  })
})
