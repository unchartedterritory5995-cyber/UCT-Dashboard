import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '../../test-utils'

// Stable overview data for all renders.
vi.mock('./hooks/useResearchOverview', () => ({
  default: () => ({
    sym: 'AAPL',
    meta: { name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics' },
    stats: { market_cap: '$2.95T', forward_pe: 28.5, beta: 1.22, week52_high: 243, week52_low: 164, div_yield: 0.42 },
    analyst: { consensus: { buy: 37, hold: 8, sell: 1 }, price_target: { targetLow: 230, targetMean: 251, targetHigh: 280 } },
    ai: { analysis_summary: 'Strong services-led beat.' },
    live: { price: 256.5, change_pct: 1.8 },
  }),
}))

// StockChart uses canvas (lightweight-charts) — stub it for jsdom.
vi.mock('../../components/StockChart', () => ({ default: () => <div data-testid="stock-chart" /> }))

// Review round 1, item 2: OwnershipTab/FilingsTab's own data hooks aren't
// mocked anywhere else in this file, and without a fetch mock they'd sit in
// perpetual isLoading — the ?section= tests below need the RESOLVED (data-
// present) render so their positive-content oracle is reachable synchronously.
// Same idiom as OwnershipTab.test.jsx / FilingsTab.test.jsx.
vi.mock('./hooks/useOwnership', () => ({
  default: () => ({ data: { institutional: { pct_held: 61 } }, isLoading: false }),
}))
vi.mock('../../hooks/useFilings', () => ({
  default: () => ({ data: { filings: [] }, isLoading: false }),
}))

// Control auth: mock the whole module so test-utils' AuthProvider is a passthrough.
const auth = { user: { role: 'user' }, isPaid: true }
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}))

import ResearchPage from './ResearchPage'

describe('ResearchPage', () => {
  it('renders the header + Overview for a paid user', () => {
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL' })
    expect(screen.getByText(/Apple Inc\./)).toBeInTheDocument()
    expect(screen.getByText(/Key stats/i)).toBeInTheDocument()
  })

  it('switches tabs away from Overview', () => {
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL' })
    expect(screen.getByText(/Key stats/i)).toBeInTheDocument()
    // All 7 tabs are live now; switching to Ratings hides the Overview content.
    fireEvent.click(screen.getByRole('button', { name: 'Ratings' }))
    expect(screen.queryByText(/Key stats/i)).not.toBeInTheDocument()
  })

  it('shows the paywall teaser for a non-paid user', () => {
    auth.isPaid = false
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL' })
    expect(screen.getByText(/Unlock AAPL Research/i)).toBeInTheDocument()
    expect(screen.queryByText(/Key stats/i)).not.toBeInTheDocument()
  })

  it('honours ?section=ownership — lands on Ownership, not just "not Overview"', () => {
    // P2 T6: EarningsResearchModal's rail LINK items deep-open
    // /research/:sym?section=ownership. Review round 1, item 2: the original
    // version of this test asserted only that Overview-only content ("Key
    // stats") was ABSENT — a negative oracle that can't tell "landed on
    // Ownership" from "landed on any other tab", so a wrong SECTION_TO_TAB
    // mapping (e.g. ownership -> Ratings) would still pass it. Assert
    // Ownership's OWN content instead (OwnershipTab.jsx:52/72).
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL?section=ownership' })
    expect(screen.getByText('Institutional ownership')).toBeInTheDocument()
    expect(screen.getByText('Short interest')).toBeInTheDocument()
  })

  it('honours ?section=filings — lands on Filings', () => {
    // The rail's OTHER link item (railSections.js `railLinks`) — untested by
    // the original version of this suite entirely (review round 1, item 2).
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL?section=filings' })
    expect(screen.getByText('SEC filings (EDGAR)')).toBeInTheDocument()
  })
})
