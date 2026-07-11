import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

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

import JournalLayout, { HOTKEY_ROUTES } from './JournalLayout'
import TodaySurface from './surfaces/TodaySurface'
import TradesSurface from './surfaces/TradesSurface'
import JournalSurface from './surfaces/JournalSurface'
import InsightsSurface from './surfaces/InsightsSurface'
import CompassSurface from './surfaces/CompassSurface'
import CommunitySurface from './surfaces/CommunitySurface'
import AccountsSurface from './surfaces/AccountsSurface'

// Probe that surfaces the live location so redirect assertions can read the
// post-Navigate URL (path + search).
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>
}

function renderAt(route, { paid = true } = {}) {
  mockIsPaid = paid
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LocationProbe />
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

describe('JournalLayout — permanent ?j2tab= redirect shim (A3)', () => {
  it('/journal?j2tab=analytics&ins=edge redirects to /journal/insights?ins=edge', () => {
    renderAt('/journal?j2tab=analytics&ins=edge')
    // Landed on the Insights surface (Analytics tab), NOT the Today placeholder.
    expect(screen.getByTestId('analytics')).toBeInTheDocument()
    expect(screen.queryByText('Today — coming in this release')).not.toBeInTheDocument()
    // URL rewritten + ins= preserved + j2tab stripped (no loop).
    expect(screen.getByTestId('loc')).toHaveTextContent('/journal/insights?ins=edge')
  })

  it('/journal?j2tab=positions redirects to the Trades / Open segment', () => {
    renderAt('/journal?j2tab=positions')
    expect(screen.getByTestId('open-positions')).toBeInTheDocument()
    expect(screen.getByTestId('loc')).toHaveTextContent('/journal/trades?seg=open')
  })

  it('/journal?j2tab=notebook&note=abc redirects to Journal / Notebook, preserving note', () => {
    renderAt('/journal?j2tab=notebook&note=abc')
    expect(screen.getByTestId('notebook')).toBeInTheDocument()
    const loc = screen.getByTestId('loc').textContent
    expect(loc).toContain('/journal/journal')
    expect(loc).toContain('note=abc')
    expect(loc).toContain('seg=notebook')
    expect(loc).not.toContain('j2tab')
  })

  it('/journal?j2tab=community redirects to the Community route', () => {
    renderAt('/journal?j2tab=community')
    expect(screen.getByTestId('community')).toBeInTheDocument()
    expect(screen.getByTestId('loc')).toHaveTextContent('/journal/community')
  })

  it('plain /journal (no j2tab) does NOT redirect — Today renders', () => {
    renderAt('/journal')
    expect(screen.getByText('Today — coming in this release')).toBeInTheDocument()
    expect(screen.getByTestId('loc')).toHaveTextContent('/journal')
  })
})

// ── g> navigation hotkey aliases (Task A4) ───────────────────────────────────
// react-hotkeys-hook v5 reads `event.code` for sequence chords (KeyG → 'g'), so
// firing two keydowns (g then <key>) drives the chord. The second keydown fires
// the callback synchronously; the internal 1s reset timer is irrelevant here.
const loc = () => screen.getByTestId('loc').textContent
function pressChord(secondCode) {
  fireEvent.keyDown(document.body, { code: 'KeyG' })
  fireEvent.keyDown(document.body, { code: secondCode })
}

describe('JournalLayout — g> navigation hotkeys (A4)', () => {
  it('HOTKEY_ROUTES maps every legacy chord + the new Today alias', () => {
    expect(HOTKEY_ROUTES['g>o']).toBe('/journal')
    expect(HOTKEY_ROUTES['g>p']).toBe('/journal/trades?seg=open')
    expect(HOTKEY_ROUTES['g>j']).toBe('/journal/trades?seg=closed')
    expect(HOTKEY_ROUTES['g>a']).toBe('/journal/journal?seg=calendar')
    expect(HOTKEY_ROUTES['g>n']).toBe('/journal/journal?seg=notebook')
    expect(HOTKEY_ROUTES['g>y']).toBe('/journal/insights')
    expect(HOTKEY_ROUTES['g>t']).toBe('/journal/accounts')
    expect(HOTKEY_ROUTES['g>k']).toBe('/journal/compass')
    expect(HOTKEY_ROUTES['g>c']).toBe('/journal/community')
  })

  it('g>y navigates to Insights', () => {
    renderAt('/journal')
    pressChord('KeyY')
    expect(loc()).toBe('/journal/insights')
    expect(screen.getByTestId('analytics')).toBeInTheDocument()
  })

  it('g>c navigates to Community', () => {
    renderAt('/journal')
    pressChord('KeyC')
    expect(loc()).toBe('/journal/community')
    expect(screen.getByTestId('community')).toBeInTheDocument()
  })

  it('g>o (Today) navigates back to /journal from another surface', () => {
    renderAt('/journal/insights')
    expect(screen.getByTestId('analytics')).toBeInTheDocument()
    pressChord('KeyO')
    expect(loc()).toBe('/journal')
    expect(screen.getByText('Today — coming in this release')).toBeInTheDocument()
  })

  it('g>p navigates to Trades / Open segment', () => {
    renderAt('/journal')
    pressChord('KeyP')
    expect(loc()).toBe('/journal/trades?seg=open')
    expect(screen.getByTestId('open-positions')).toBeInTheDocument()
  })

  it('g>k routes to Compass when paid', () => {
    renderAt('/journal', { paid: true })
    pressChord('KeyK')
    expect(loc()).toBe('/journal/compass')
  })

  it('g>k is a no-op for free users (Compass stays locked)', () => {
    renderAt('/journal', { paid: false })
    pressChord('KeyK')
    expect(loc()).toBe('/journal')
  })
})
