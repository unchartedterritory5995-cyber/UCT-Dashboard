import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

// 2026-09-03 dedicated Analyst Ratings slice (owner-authorized product-home
// split). This tab owns third-party analyst consensus / price-target /
// recent-action content that used to live inside EstimatesTab.jsx (see
// EstimatesTab.test.jsx for the narrowed-Estimates coverage) and is
// deliberately distinct from RatingsTab (UCT's own composite methodology).

// TERM-073's revision panel fetches on its own; its behaviour is covered by
// AnalystRevisions.test.jsx, so here it is stubbed and the tab is tested alone.
vi.mock('./AnalystRevisions', () => ({ default: () => null }))

vi.mock('../../../hooks/useLivePrices', () => ({
  default: () => ({ prices: { AAPL: { price: 200, change_pct: 1.2 } }, isLoading: false, error: null, refresh: () => {} }),
}))

const fullData = {
  sym: 'AAPL',
  entity: { status: 'resolved', entityId: 'e_aapl' },
  consensus: {
    strongBuy: 1, buy: 69, hold: 34, sell: 7, strongSell: 0, total: 111, label: 'Buy',
    _meta: {
      vendor: 'fmp', sourceActivity: 'fmp_client.get_grades_consensus',
      sourceObservedAt: 1735689600, tieBreak: null, freshnessClass: 'end_of_day',
      licensingClass: 'R', degraded: null,
    },
  },
  price_target: {
    high: 400, low: 253, median: 325, consensus: 250,
    last_month: { count: 4, avg: 337.5 }, last_quarter: { count: 14, avg: 326.86 }, last_year: { count: 60, avg: 299.43 },
    _meta: {
      vendor: 'fmp', sourceActivity: 'fmp_client.get_price_target_consensus',
      sourceObservedAt: 1735689600, tieBreak: null, freshnessClass: 'end_of_day',
      licensingClass: 'R', degraded: null,
    },
  },
  recent_actions: {
    items: [
      { date: '2026-09-01', company: 'Evercore ISI', action: 'upgrade', from_grade: 'Hold', to_grade: 'Buy' },
    ],
    _meta: {
      vendor: 'fmp', sourceActivity: 'fmp_client.get_analyst_grades',
      sourceObservedAt: 1735689600, tieBreak: null, freshnessClass: 'end_of_day',
      licensingClass: 'R', degraded: null,
    },
  },
}

describe('AnalystRatingsTab', () => {
  it('renders consensus, price target (with live-price upside/downside), and recent actions', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useAnalystRatings', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    const { default: FreshTab } = await import('./AnalystRatingsTab')
    render(<FreshTab sym="AAPL" />)

    const consensusSection = screen.getByText('Analyst consensus').closest('section')
    expect(within(consensusSection).getByText('111 analysts')).toBeInTheDocument()
    // the headline consensus label (distinct from the per-bucket "69 Buy" breakdown)
    expect(within(consensusSection).getByTestId('consensus-label')).toHaveTextContent(/^Buy$/)

    const ptSection = screen.getByText('Price target').closest('section')
    expect(within(ptSection).getByText('$250')).toBeInTheDocument() // consensus mid
    // livePrice 200, ptMid 250 -> +25.0%
    expect(within(ptSection).getByText('+25.0%')).toBeInTheDocument()

    expect(screen.getByText('Recent analyst actions')).toBeInTheDocument()
    expect(screen.getByText('Evercore ISI')).toBeInTheDocument()
  })

  it('composes Provenance + FreshnessBadge from D1 meta on all three cards', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useAnalystRatings', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    const { default: FreshTab } = await import('./AnalystRatingsTab')
    render(<FreshTab sym="AAPL" />)

    const toggles = screen.getAllByTestId('provenance-detail-toggle')
    expect(toggles).toHaveLength(3) // consensus, price target, recent actions
    expect(screen.getAllByText('FMP')).toHaveLength(3)
  })

  it('renders an honest note when the symbol has not resolved to a canonical entity', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useAnalystRatings', () => ({
      default: () => ({
        data: { sym: 'ZZZ', entity: { status: 'not_found', entityId: null }, consensus: null, price_target: null, recent_actions: { items: [], _meta: null } },
        isLoading: false,
      }),
    }))
    const { default: FreshTab } = await import('./AnalystRatingsTab')
    render(<FreshTab sym="ZZZ" />)
    expect(screen.getByTestId('entity-unresolved-note')).toHaveTextContent('not yet linked to a company record') // plain English, never the enum
  })

  it('shows the empty-state note when there is no coverage at all', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useAnalystRatings', () => ({
      default: () => ({
        data: { sym: 'ZZZ', entity: { status: 'resolved', entityId: 'e_1' }, consensus: null, price_target: null, recent_actions: { items: [], _meta: null } },
        isLoading: false,
      }),
    }))
    const { default: FreshTab } = await import('./AnalystRatingsTab')
    render(<FreshTab sym="ZZZ" />)
    expect(screen.getByTestId('analyst-ratings-empty').textContent).toBe('No analyst coverage on file for ZZZ.')
  })

  it('never populates a per-action price target (unverified field, owner decision 3)', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useAnalystRatings', () => ({ default: () => ({ data: fullData, isLoading: false }) }))
    const { default: FreshTab } = await import('./AnalystRatingsTab')
    render(<FreshTab sym="AAPL" />)
    // RatingChangeList renders a blank pt cell rather than any fabricated value.
    expect(screen.queryByText(/^\$0/)).not.toBeInTheDocument()
  })

  // TERM-088 -- a failed read must render as an error, never as the genuine
  // "analyst rating data is unavailable" empty state.
  it('renders the error state on a failed read, not "Analyst rating data is unavailable"', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useAnalystRatings', () => ({ default: () => ({ data: null, isLoading: false, error: true, mutate: () => {} }) }))
    const { default: FreshTab } = await import('./AnalystRatingsTab')
    render(<FreshTab sym="AAPL" />)
    expect(screen.getByTestId('analyst-ratings-error')).toHaveTextContent("Couldn't load analyst ratings")
    expect(screen.queryByTestId('analyst-ratings-empty')).not.toBeInTheDocument()
  })

  it('still renders the genuine empty state when the read succeeded with no coverage', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useAnalystRatings', () => ({
      default: () => ({
        data: { sym: 'ZZZ', entity: { status: 'resolved', entityId: 'e_1' }, consensus: null, price_target: null, recent_actions: { items: [], _meta: null } },
        isLoading: false,
        error: false,
        mutate: () => {},
      }),
    }))
    const { default: FreshTab } = await import('./AnalystRatingsTab')
    render(<FreshTab sym="ZZZ" />)
    expect(screen.getByTestId('analyst-ratings-empty').textContent).toBe('No analyst coverage on file for ZZZ.')
    expect(screen.queryByTestId('analyst-ratings-error')).not.toBeInTheDocument()
  })

  // tq-panels: a PARTIAL outage (some legs failed) is stamped `outage` by the route and
  // said in words; the sections that answered still render.
  it('a partial outage says some data could not be read, and still shows what answered', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useAnalystRatings', () => ({
      default: () => ({ data: { ...fullData, price_target: null, outage: true }, isLoading: false, error: false, mutate: () => {} }),
    }))
    const { default: FreshTab } = await import('./AnalystRatingsTab')
    render(<FreshTab sym="AAPL" />)
    expect(screen.getByTestId('analyst-ratings-partial').textContent)
      .toMatch(/^Some of AAPL's analyst data could not be read right now; what is shown is what answered\./)
    expect(screen.getByText('Analyst consensus')).toBeInTheDocument()
    expect(screen.queryByTestId('analyst-ratings-empty')).toBeNull()
  })

  it('Retry calls mutate', async () => {
    vi.resetModules()
    const mutate = vi.fn()
    vi.doMock('../hooks/useAnalystRatings', () => ({ default: () => ({ data: null, isLoading: false, error: true, mutate }) }))
    const { default: FreshTab } = await import('./AnalystRatingsTab')
    render(<FreshTab sym="AAPL" />)
    screen.getByText('Retry').click()
    expect(mutate).toHaveBeenCalled()
  })
})

// tq-panels: the route marks a fund (e910f8ff6); the tab says so, not "no coverage".
describe('AnalystRatingsTab -- a fund', () => {
  it('says not applicable to funds with the route reason', async () => {
    vi.resetModules()
    vi.doMock('../hooks/useAnalystRatings', () => ({
      default: () => ({ data: { sym: 'SPY', entity: null, consensus: null, price_target: null,
        recent_actions: { items: [], _meta: null }, outage: false, not_applicable: 'fund',
        reason: 'SPY is a fund; funds carry no sell-side analyst ratings or price targets' }, isLoading: false, error: false, mutate: () => {} }),
    }))
    const { default: Fresh } = await import('./AnalystRatingsTab')
    render(<Fresh sym="SPY" />)
    expect(screen.getByTestId('analyst-ratings-na').textContent)
      .toBe('Not applicable to funds — SPY is a fund; funds carry no sell-side analyst ratings or price targets.')
    expect(screen.queryByTestId('analyst-ratings-empty')).toBeNull()
  })
})
