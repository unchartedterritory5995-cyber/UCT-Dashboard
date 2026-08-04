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

  it('honours ?section= so the modal rail links land where they promise', () => {
    // P2 T6: EarningsResearchModal's rail LINK items deep-open
    // /research/:sym?section=ownership — this is the whole contract on the
    // page side. Reuse this suite's existing "which tab is active" oracle
    // (test above: Overview-only content disappears once another tab is
    // active) rather than a CSS-module className check.
    auth.isPaid = true
    renderWithProviders(<ResearchPage />, { route: '/research/AAPL?section=ownership' })
    expect(screen.queryByText(/Key stats/i)).not.toBeInTheDocument()
  })
})
