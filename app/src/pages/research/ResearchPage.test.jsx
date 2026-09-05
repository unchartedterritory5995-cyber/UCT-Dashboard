import { describe, it, expect, vi, beforeEach } from 'vitest'
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
// 2026-09-03 dedicated Analyst Ratings slice: the new tab needs its own data
// hook resolved (not perpetually loading) so ?section=analyst-ratings has
// positive content to assert against, mirroring Ownership/Filings above.
vi.mock('./hooks/useAnalystRatings', () => ({
  default: () => ({
    data: {
      sym: 'AAPL', entity: { status: 'resolved', entityId: 'e_1' },
      consensus: { label: 'Buy', total: 10, strongBuy: 2, buy: 6, hold: 2, sell: 0, strongSell: 0 },
      price_target: null, recent_actions: { items: [], _meta: null },
    },
    isLoading: false,
  }),
}))
// A8 News/Intelligence Slice 1 (2026-09-04): same idiom -- the new tab's
// own hook resolved so ?section=news has positive content to assert.
vi.mock('./hooks/useCompanyNews', () => ({
  default: () => ({
    data: { sym: 'AAPL', entity: { status: 'resolved', entityId: 'e_1' }, items: [], _meta: null },
    isLoading: false,
  }),
}))

// Control auth: mock the whole module so test-utils' AuthProvider is a passthrough.
const auth = { user: { role: 'user' }, isPaid: true }
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}))

// S7 filing-watch — controlled mock so the header action's tests are
// deterministic rather than depending on an unmocked real fetch.
const filingWatchMock = vi.hoisted(() => ({
  watchState: vi.fn(() => 'NOT_WATCHING'),
  getWatch: vi.fn(() => null),
  createOrReactivate: vi.fn(),
  suspend: vi.fn(),
}))
vi.mock('../../hooks/useFilingWatch', () => ({ default: () => filingWatchMock }))

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

  it('honours ?section=analyst-ratings — lands on the new Analyst Ratings tab', () => {
    // 2026-09-03 dedicated Analyst Ratings slice: a new tab, not a rename of
    // Estimates or Ratings (UCT Composite) -- assert its own content.
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL?section=analyst-ratings' })
    expect(screen.getByText('Analyst consensus')).toBeInTheDocument()
    expect(screen.queryByText(/Key stats/i)).not.toBeInTheDocument()
  })

  it('renders the "Analyst Ratings" tab button distinct from "Ratings" (UCT Composite)', () => {
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL' })
    expect(screen.getByRole('button', { name: 'Analyst Ratings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ratings' })).toBeInTheDocument()
  })

  it('honours ?section=news — lands on the new News tab', () => {
    // A8 Slice 1 (2026-09-04): a new, security-scoped tab, distinct from the
    // calendar modal's own News tab (untouched compatibility bridge).
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL?section=news' })
    expect(screen.getByText('No recent news for this ticker.')).toBeInTheDocument()
    expect(screen.queryByText(/Key stats/i)).not.toBeInTheDocument()
  })

  it('renders the "News" tab button', () => {
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL' })
    expect(screen.getByRole('button', { name: 'News' })).toBeInTheDocument()
  })

  it('honours ?section=ai — lands on the new Ask AI tab', () => {
    // AI-Native Research Assistant Slice 1 (2026-09-04): the one contextual
    // AI door inside the existing research experience.
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL?section=ai' })
    expect(screen.getByText('Ask AI — AAPL')).toBeInTheDocument()
    expect(screen.queryByText(/Key stats/i)).not.toBeInTheDocument()
  })

  it('renders the "Ask AI" tab button', () => {
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL' })
    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeInTheDocument()
  })
})

describe('S7 filing-watch header action (Stage 4, D7 — visible regardless of active tab)', () => {
  beforeEach(() => {
    auth.isPaid = true
    filingWatchMock.watchState.mockReset().mockReturnValue('NOT_WATCHING')
    filingWatchMock.getWatch.mockReset().mockReturnValue(null)
    filingWatchMock.createOrReactivate.mockReset()
    filingWatchMock.suspend.mockReset()
  })

  it('renders on Overview and creates a watch for the security on click', () => {
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL' })
    const btn = screen.getByRole('button', { name: /Notify me about new SEC filings for AAPL/ })
    fireEvent.click(btn)
    expect(filingWatchMock.createOrReactivate).toHaveBeenCalledWith('AAPL')
  })

  it('is still present after switching to a non-Overview tab (does not live inside a tab body)', () => {
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL' })
    fireEvent.click(screen.getByRole('button', { name: 'Filings' }))
    expect(screen.getByRole('button', { name: /Notify me about new SEC filings for AAPL/ })).toBeInTheDocument()
  })

  it('ACTIVE: renders "Watching SEC filings" and suspends on click', () => {
    filingWatchMock.watchState.mockReturnValue('ACTIVE')
    filingWatchMock.getWatch.mockReturnValue({ id: 'p1' })
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL' })
    const btn = screen.getByRole('button', { name: /Watching SEC filings/ })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(btn)
    expect(filingWatchMock.suspend).toHaveBeenCalledWith('p1', 'AAPL')
  })

  it('SUSPENDED: reactivates via the same create call', () => {
    filingWatchMock.watchState.mockReturnValue('SUSPENDED')
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL' })
    fireEvent.click(screen.getByRole('button', { name: /Filing watch suspended/ }))
    expect(filingWatchMock.createOrReactivate).toHaveBeenCalledWith('AAPL')
  })
})
