import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

// CompassOverview is presentational — it reads its whole shape from the
// `overview` prop and renders synchronously, no hooks/router to mock.
import CompassOverview from './CompassOverview'

const baseOverview = {
  profile_excerpt: 'Trades breakouts, sizes conservatively.',
  onboarded: true,
  this_weeks_focus: 'Cut losers faster.',
  week_to_date: { trade_count: 3, net_pnl_dollar: 120, avg_r: 0.4 },
  today: { trade_count: 1, net_pnl_dollar: 40 },
  regime: 'green',
  active_interventions_count: 0,
  pending_profile_suggestions_count: 0,
  recent_trade_reviews: [],
}

describe('CompassOverview', () => {
  it('renders null when overview is null', () => {
    const { container } = render(<CompassOverview overview={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  // PACKET-W CP1 (fingerprint 425778f2c): the header label is retired --
  // `overview.regime` is unchanged (still reads the four-tier bucket), only
  // the displayed word is renamed away from "Regime".
  it('labels the header stat "Exposure Backdrop", never "Regime"', () => {
    render(<CompassOverview overview={baseOverview} />)
    expect(screen.getByText(/Exposure Backdrop:/i)).toBeInTheDocument()
    expect(screen.getByText('green')).toBeInTheDocument()
    expect(screen.queryByText(/^Regime:/i)).not.toBeInTheDocument()
  })

  it('never renders the bare word "regime" anywhere a member reads', () => {
    const { container } = render(<CompassOverview overview={baseOverview} />)
    expect(container.textContent).not.toMatch(/\bregimes?\b/i)
  })

  it('omits the stat entirely when regime is falsy', () => {
    const { container } = render(
      <CompassOverview overview={{ ...baseOverview, regime: null }} />
    )
    expect(container.textContent).not.toMatch(/Exposure Backdrop/i)
  })
})
