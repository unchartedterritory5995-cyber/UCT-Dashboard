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

  it('audit 2026-10-08: SMR and Acc / Dis say in plain words what they grade, visibly and to a screen reader', () => {
    render(<RatingsTab sym="AAPL" />)
    expect(screen.getByTestId('rating-hint-smr')).toHaveTextContent(/Sales growth, profit margin and return on equity/)
    expect(screen.getByTestId('rating-hint-accdis')).toHaveTextContent(/volume on up days against down days/)
    // The letter itself is described by the hint, so a screen reader hears what "A" means.
    const smrLetter = screen.getByText('A', { selector: '[aria-describedby="rating-hint-smr"]' })
    expect(smrLetter).toHaveAccessibleDescription(/return on equity/)
  })

  it('audit 2026-10-08: each numeric sub-score bar is a labelled meter with its value', () => {
    render(<RatingsTab sym="AAPL" />)
    const eps = screen.getByRole('meter', { name: 'EPS Strength, 0 to 99' })
    expect(eps).toHaveAttribute('aria-valuenow', '90')
    expect(eps).toHaveAttribute('aria-valuetext', '90 of 99')
    expect(screen.getAllByRole('meter')).toHaveLength(4)
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
    expect(screen.queryByTestId('ratings-empty')).not.toBeInTheDocument()
  })

  // tq-panels: the server ALWAYS sends the seven component keys (null when unmeasured),
  // so the old `!Object.keys(comp).length` empty test could never fire. Use the real shape.
  const BLANK = { sym: 'AAPL', composite: null, checkup: [],
    components: { eps: null, rs: null, growth: null, value: null, smr: null, accdis: null, sponsorship: null } }

  it('an all-blank rating whose legs all answered says there are no inputs on file', async () => {
    await renderWith({ data: { ...BLANK, complete: true }, isLoading: false, error: false, mutate: () => {} })
    expect(screen.getByTestId('ratings-empty').textContent)
      .toBe('No rating inputs on file for AAPL: none of the seven components could be measured.')
    expect(screen.queryByText('UCT Composite Rating')).toBeNull()
    expect(screen.queryByTestId('ratings-error')).not.toBeInTheDocument()
  })

  it('an all-blank rating with a failed leg says it could not read the inputs, with Retry', async () => {
    await renderWith({ data: { ...BLANK, complete: false }, isLoading: false, error: false, mutate: () => {} })
    expect(screen.getByTestId('ratings-error').textContent).toMatch(/^Couldn't read the inputs for AAPL's rating/)
  })

  it('a fund says not applicable to funds -- no composite', async () => {
    // the route's fund shape (fix/terminal-quality-routes-3, e910f8ff6)
    await renderWith({ data: { sym: 'SPY', not_applicable: 'fund', composite: null, components: {}, checkup: [], coverage: null,
      reason: "SPY is a fund; the UCT composite rates a company's earnings, growth, margins and value, which a fund does not have" },
    isLoading: false, error: false, mutate: () => {} })
    expect(screen.getByTestId('ratings-na').textContent).toMatch(/^Not applicable to funds: SPY is a fund; the UCT composite rates a company/)
    expect(screen.queryByText('UCT Composite Rating')).toBeNull()
  })

  it('Retry calls mutate', async () => {
    const mutate = vi.fn()
    await renderWith({ data: null, isLoading: false, error: true, mutate })
    screen.getByText('Retry').click()
    expect(mutate).toHaveBeenCalled()
  })
})
