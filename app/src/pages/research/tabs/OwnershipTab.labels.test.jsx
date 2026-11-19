// app/src/pages/research/tabs/OwnershipTab.labels.test.jsx
//
// The tab prints the institutional percent in TWO places: the headline in the
// Institutional ownership card and the 13F card's own stat with its change over
// the quarter. Both were once labeled "Institutional ownership" (and came from
// two providers that disagreed), so the page read as though it contradicted
// itself. Both now read the Form 13F summary, and the labels still have to say
// what each one is. This pins that they never collapse back to the same words.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const data = {
  sym: 'ATROB',
  entity: { status: 'resolved', entityId: 'em_atrob' },
  institutional: { state: 'ok', pct_held: 71.86, quarter: '2026Q2' },
  short: { state: 'ok', shares_short: 1e5, short_pct_float: 0.4, days_to_cover: 1.1, settlement_date: '2026-10-30' },
  share_counts: { float_shares: 19093178, shares_outstanding: 35851963, _meta: null },
  insider: [],
  thirteen_f: {
    quarter: '2026Q2',
    summary: { ownership_pct: 71.86, ownership_change: 0.4693, investors_holding: 8, total_invested: 13633685 },
    holders: [],
    _meta: null,
  },
}

vi.mock('../hooks/useOwnership', () => ({ default: () => ({ data, isLoading: false }) }))

import OwnershipTab from './OwnershipTab'

describe('OwnershipTab — the two ownership figures are distinguishable', () => {
  it('shows both numbers under labels that are not the same words', () => {
    render(<OwnershipTab sym="ATROB" />)

    // Both places are still present — the fix is disambiguation, not hiding
    // one of them. A member auditing a 13F needs the 13F stat and its change.
    expect(screen.getByText('71.86%')).toBeInTheDocument()
    expect(screen.getByText('71.9%')).toBeInTheDocument()
    expect(screen.getByText('+0.47pp')).toBeInTheDocument()

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

  it('13F values are US dollars, and the label says so (owner decision 2026-10-07)', () => {
    render(<OwnershipTab sym="ATROB" />)
    expect(screen.getByText('Total invested (USD)')).toBeInTheDocument()
    expect(screen.getByText('Total invested (USD)').parentElement).toHaveTextContent('$13.6')
  })

  it('the 13F block still carries the quarter it belongs to', () => {
    render(<OwnershipTab sym="ATROB" />)
    // Without the quarter, "Held by 13F filers" is an undated claim.
    expect(screen.getByText(/2026Q2/)).toBeInTheDocument()
  })
})
