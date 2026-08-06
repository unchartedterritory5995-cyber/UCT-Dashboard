// app/src/pages/research/tabs/OwnershipTab.labels.test.jsx
//
// The tab renders TWO institutional-ownership percentages from two different
// providers, and they disagree by an order of magnitude on essentially every
// ticker (live 2026-08-06: AAPL 65.95% vs 6.38%; ATROB 71.85% vs 0.47%).
// Both were labeled "Institutional ownership", so the page read as though it
// contradicted itself. They are different measures — the aggregate stake vs
// the positions inside one quarter's 13F filings — and the labels have to say
// so. This pins that they never collapse back to the same words.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const data = {
  sym: 'ATROB',
  institutional: { pct_held: 71.85, holders: [] },
  short: { shares_short: 1e5, short_pct_float: 0.4, days_to_cover: 1.1, float_shares: 19093178, shares_outstanding: 35851963 },
  insider: [],
  thirteen_f: {
    quarter: '2026Q2',
    summary: { ownership_pct: 0.4693, investors_holding: 8, total_invested: 13633685 },
    holders: [],
  },
}

vi.mock('../hooks/useOwnership', () => ({ default: () => ({ data, isLoading: false }) }))

import OwnershipTab from './OwnershipTab'

describe('OwnershipTab — the two ownership figures are distinguishable', () => {
  it('shows both numbers under labels that are not the same words', () => {
    render(<OwnershipTab sym="ATROB" />)

    // Both figures are still present — the fix is disambiguation, not hiding
    // one of them. A member auditing a 13F needs the 13F number.
    expect(screen.getByText('71.85%')).toBeInTheDocument()
    expect(screen.getByText('0.5%')).toBeInTheDocument()

    // The aggregate figure names its denominator; the 13F figure names its
    // source. Neither reads as the bare, ambiguous "Institutional ownership".
    expect(screen.getByText('% of shares outstanding')).toBeInTheDocument()
    expect(screen.getByText('Held by 13F filers')).toBeInTheDocument()
    expect(screen.queryByText('% held by institutions')).toBeNull()

    // The card heading may still say "Institutional ownership" (it heads the
    // whole card), but no two VALUE labels may be identical — that identity
    // is exactly what made the page look self-contradictory.
    expect(screen.queryAllByText('Institutional ownership')).toHaveLength(1)
  })

  it('the 13F block still carries the quarter it belongs to', () => {
    render(<OwnershipTab sym="ATROB" />)
    // Without the quarter, "Held by 13F filers" is an undated claim.
    expect(screen.getByText(/2026Q2/)).toBeInTheDocument()
  })
})
