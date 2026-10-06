import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const data = {
  sym: 'AAPL',
  entity: { status: 'resolved', entityId: 'em_aapl' },
  composite: 91,
  components: { eps: 90, rs: 88, growth: 80, value: 41, smr: 'A', accdis: 'B', sponsorship: 'A' },
  checkup: [
    { label: 'EPS growth ≥ 25%', status: 'pass', value: '+30%' },
    { label: 'Debt/equity < 1.5x', status: 'fail', value: '2.10x' },
  ],
  method: 'Threshold-calibrated v1 — absolute scoring.',
  price_as_of: '2026-09-02',
}

vi.mock('../hooks/useRatings', () => ({ default: () => ({ data, isLoading: false }) }))

import RatingsTab from './RatingsTab'

describe('RatingsTab', () => {
  it('renders composite, components, and the stock checkup', () => {
    render(<RatingsTab sym="AAPL" />)
    expect(screen.getByText('91')).toBeInTheDocument()                 // composite
    expect(screen.getByText('UCT Composite Rating')).toBeInTheDocument()
    expect(screen.getByText('EPS Strength')).toBeInTheDocument()
    expect(screen.getByText('Relative Strength')).toBeInTheDocument()
    expect(screen.getByText('EPS growth ≥ 25%')).toBeInTheDocument()
    expect(screen.getByText('+30%')).toBeInTheDocument()
    expect(screen.getByText(/Threshold-calibrated/)).toBeInTheDocument()
    // A resolved entity shows no unresolved-identity note.
    expect(screen.queryByTestId('entity-unresolved-note')).toBeNull()
  })

  it('discloses the price leg\'s as-of date, never a provider badge', () => {
    render(<RatingsTab sym="AAPL" />)
    expect(screen.getByText(/price data as of 2026-09-02/)).toBeInTheDocument()
    // This is a UCT-derived composite — no source/vendor "Provenance" chip.
    expect(screen.queryByText('FMP')).toBeNull()
  })

  it('shows an entity-unresolved note when Entity Master has not linked the symbol', () => {
    data.entity = { status: 'ambiguous', entityId: null }
    render(<RatingsTab sym="AAPL" />)
    expect(screen.getByTestId('entity-unresolved-note')).toHaveTextContent('not yet linked to a company record') // plain English, never the enum
    data.entity = { status: 'resolved', entityId: 'em_aapl' }
  })
})

// TERM-088 -- a failed read must render as an error, never as the genuine
// "ratings are unavailable" empty state. vi.resetModules + vi.doMock so each
// case gets a fresh mock independent of the static one above.
describe('RatingsTab -- failed read vs genuine empty state', () => {
  async function renderWith(mockReturn) {
    vi.resetModules()
    vi.doMock('../hooks/useRatings', () => ({ default: () => mockReturn }))
    const { default: FreshTab } = await import('./RatingsTab')
    return render(<FreshTab sym="AAPL" />)
  }

  it('renders the error state on a failed read, not "Ratings are unavailable"', async () => {
    await renderWith({ data: null, isLoading: false, error: true, mutate: () => {} })
    expect(screen.getByTestId('ratings-error')).toHaveTextContent("Couldn't load ratings")
    expect(screen.queryByText('Ratings are unavailable for this ticker.')).not.toBeInTheDocument()
  })

  it('still renders the genuine empty state when the read succeeded with no rating', async () => {
    await renderWith({ data: {}, isLoading: false, error: false, mutate: () => {} })
    expect(screen.getByText('Ratings are unavailable for this ticker.')).toBeInTheDocument()
    expect(screen.queryByTestId('ratings-error')).not.toBeInTheDocument()
  })

  it('Retry calls mutate', async () => {
    const mutate = vi.fn()
    await renderWith({ data: null, isLoading: false, error: true, mutate })
    screen.getByText('Retry').click()
    expect(mutate).toHaveBeenCalled()
  })
})
