import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

// ── controllable paid state ──────────────────────────────────────────────────
let mockIsPaid = true
vi.mock('../../context/AuthContext', () => ({
  useIsPaid: () => mockIsPaid,
  useAuth: () => ({ isPaid: mockIsPaid }),
}))

// ── shell hooks / header pieces / modals (stubbed — routing is under test) ────
vi.mock('./hooks/useJ2Settings', () => ({
  default: () => ({
    settings: { setups: [] },
    isLoading: false,
    error: null,
    save: vi.fn(),
    accountName: 'Default',
    isAllAccounts: false,
  }),
}))
vi.mock('./hooks/useBrokerSync', () => ({ default: () => {} }))
vi.mock('./components/accounts/AccountSelector', () => ({
  default: () => <div data-testid="account-selector" />,
}))
vi.mock('./components/PortfolioSettingsModal', () => ({ default: () => null }))
vi.mock('./components/accounts/NewAccountModal', () => ({ default: () => null }))
vi.mock('./components/GenerateReportModal', () => ({ default: () => null }))
vi.mock('./components/ShortcutCheatSheet', () => ({ default: () => null }))

// ── heavy tab components the surfaces host (simple stubs) ─────────────────────
vi.mock('./tabs/OpenPositionsTab', () => ({
  default: () => <div data-testid="open-positions" />,
}))
vi.mock('./tabs/TradeJournalTab', () => ({
  default: () => <div data-testid="trade-journal" />,
}))
vi.mock('./tabs/CalendarTab', () => ({ default: () => <div data-testid="calendar" /> }))
vi.mock('./tabs/NotebookTab', () => ({ default: () => <div data-testid="notebook" /> }))
vi.mock('./tabs/AnalyticsTab', () => ({ default: () => <div data-testid="analytics" /> }))
vi.mock('./tabs/CompassTab', () => ({ default: () => <div data-testid="compass" /> }))
vi.mock('./tabs/CommunityTab', () => ({ default: () => <div data-testid="community" /> }))
vi.mock('./tabs/AccountsTab', () => ({ default: () => <div data-testid="accounts" /> }))

import JournalLayout from './JournalLayout'
import TodaySurface from './surfaces/TodaySurface'
import TradesSurface from './surfaces/TradesSurface'
import JournalSurface from './surfaces/JournalSurface'
import InsightsSurface from './surfaces/InsightsSurface'
import CompassSurface from './surfaces/CompassSurface'
import CommunitySurface from './surfaces/CommunitySurface'
import AccountsSurface from './surfaces/AccountsSurface'

function renderAt(route, { paid = true } = {}) {
  mockIsPaid = paid
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/journal" element={<JournalLayout />}>
          <Route index element={<TodaySurface />} />
          <Route path="trades" element={<TradesSurface />} />
          <Route path="journal" element={<JournalSurface />} />
          <Route path="insights" element={<InsightsSurface />} />
          <Route path="compass" element={<CompassSurface />} />
          <Route path="community" element={<CommunitySurface />} />
          <Route path="accounts" element={<AccountsSurface />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockIsPaid = true
})

describe('JournalLayout — primary nav', () => {
  it('renders the 5 primary nav items as links (paid)', () => {
    renderAt('/journal')
    for (const label of ['Today', 'Trades', 'Journal', 'Insights', 'Compass']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('has no emoji in the nav', () => {
    renderAt('/journal')
    const nav = screen.getByRole('navigation', { name: 'Journal sections' })
    // Any pictographic / dingbat emoji would fail this — icons are inline SVG.
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
    expect(nav.textContent).not.toMatch(emoji)
    expect(nav.textContent).toBe('TodayTradesJournalInsightsCompass')
  })
})

describe('JournalLayout — surfaces via nested routes', () => {
  it('the index route renders the Today placeholder', () => {
    renderAt('/journal')
    expect(screen.getByText('Today — coming in this release')).toBeInTheDocument()
  })

  it('navigating to Trades renders TradesSurface with the Open segment active', () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('link', { name: 'Trades' }))
    // Open segment default → Open Positions tab renders, Trade Journal does not.
    expect(screen.getByTestId('open-positions')).toBeInTheDocument()
    expect(screen.queryByTestId('trade-journal')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Open Positions' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('Trades ?seg=closed renders the Closed (Trade Journal) segment', () => {
    renderAt('/journal/trades?seg=closed')
    expect(screen.getByTestId('trade-journal')).toBeInTheDocument()
    expect(screen.queryByTestId('open-positions')).not.toBeInTheDocument()
  })

  it('Insights route renders the Analytics tab', () => {
    renderAt('/journal/insights')
    expect(screen.getByTestId('analytics')).toBeInTheDocument()
  })
})

describe('JournalLayout — Compass paid gating', () => {
  it('shows Compass as a link when paid', () => {
    renderAt('/journal', { paid: true })
    expect(screen.getByRole('link', { name: 'Compass' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compass' })).not.toBeInTheDocument()
  })

  it('shows Compass as a present-but-disabled teaser when NOT paid (never hidden)', () => {
    renderAt('/journal', { paid: false })
    // Still present — never hidden from free users.
    expect(screen.getByText('Compass')).toBeInTheDocument()
    // Teaser is a disabled button, not a navigable link.
    const compass = screen.getByRole('button', { name: 'Compass' })
    expect(compass).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Compass' })).not.toBeInTheDocument()
  })

  it('gates the Compass route with a teaser for a free deep-link', () => {
    renderAt('/journal/compass', { paid: false })
    expect(screen.getByText('Compass — your AI trading coach')).toBeInTheDocument()
    expect(screen.queryByTestId('compass')).not.toBeInTheDocument()
  })
})
