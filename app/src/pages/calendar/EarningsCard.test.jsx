// app/src/pages/calendar/EarningsCard.test.jsx
// Unit tests for the REAL EarningsCard (not mocked).
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
  it('renders the ticker and timing label when timing is provided', () => {
    render(<EarningsCard entry={{ sym: 'AAPL', date: '2026-06-02' }} timing="bmo" />)
    expect(screen.getByText('AAPL')).toBeTruthy()
    expect(screen.getAllByText('BMO').length).toBeGreaterThan(0)
  })

  it('does not throw when timing is missing (defensive guard)', () => {
    expect(() =>
      render(<EarningsCard entry={{ sym: 'AAPL', date: '2026-06-02' }} />),
    ).not.toThrow()
    expect(screen.getByText('AAPL')).toBeTruthy()
  })

  it('renders the beat history as a plain sentence (not bars)', () => {
    render(
      <EarningsCard
        entry={{
          sym: 'AAPL', date: '2026-06-02',
          beat_history: [{ beat: true }, { beat: true }, { beat: false }, { beat: true }],
        }}
        timing="amc"
      />,
    )
    expect(screen.getByText(/Beat 3 of last 4 quarters/)).toBeTruthy()
  })
})
