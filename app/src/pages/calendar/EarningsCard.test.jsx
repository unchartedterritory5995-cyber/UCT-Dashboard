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

  it('renders the beat history as a dot strip with the count in its label', () => {
    // Phase 2: the sentence became a dot strip — color never the sole carrier,
    // the count lives in the accessible label + tooltip.
    render(
      <EarningsCard
        entry={{
          sym: 'AAPL', date: '2026-06-02',
          beat_history: [{ beat: true }, { beat: true }, { beat: false }, { beat: true }],
        }}
        timing="amc"
      />,
    )
    expect(screen.getByLabelText('Beat 3 of last 4 quarters')).toBeTruthy()
  })

  it('shows the implied-vs-realized pair when both numbers exist', () => {
    render(
      <EarningsCard
        entry={{
          sym: 'NVDA', date: '2026-08-26',
          expected_move: { pct: 8.2 },
          hist_stats: { avg_abs_move: 4.1, last_n: [3.2, -1.1, 6.0] },
        }}
        timing="amc"
      />,
    )
    expect(screen.getByText(/±8.2%/)).toBeTruthy()
    expect(screen.getByText(/typ ±4.1%/)).toBeTruthy()
    // 8.2 > 1.3 × 4.1 → options pricing flagged rich
    expect(screen.getByText('· rich')).toBeTruthy()
  })

  it('prior actual rides beside the estimate', () => {
    render(
      <EarningsCard
        entry={{
          sym: 'PEP', date: '2026-07-16', eps_est: 2.21,
          beat_history: [{ beat: true, actual: 2.05 }],
        }}
        timing="bmo"
      />,
    )
    expect(screen.getByText(/last \$2.05/)).toBeTruthy()
  })
})
