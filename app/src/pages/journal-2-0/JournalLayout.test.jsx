import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
// ⛔ A2R-04 (a11y second review, 2026-10-01): the real ShortcutCheatSheet is
// NOT stubbed — the "JournalLayout — keyboard shortcuts door (A2R-04)" block
// below needs the real button + real dialog to exercise Enter/Space and the
// "?" shortcut end to end. Every other describe block in this file never
// opens the dialog (`showShortcuts` defaults false, and the real component
// renders null when closed exactly like the old stub did), so this is a
// behavior-preserving change for them.

// ── "+ Log Trade" (A5) deps: selected-account hook + the two heavy add modals ─
vi.mock('./hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: 'a1',
    account: { id: 'a1', name: 'Default' },
    accounts: [{ id: 'a1', name: 'Default' }],
    setAccount: vi.fn(),
    isLoading: false,
  }),
}))
vi.mock('./components/AddPositionModal', () => ({
  default: ({ onSave, onClose }) => (
    <div data-testid="add-position-modal" role="dialog" aria-label="Add Position">
      <button type="button" onClick={() => onSave({ symbol: 'NVDA', side: 'Long' })}>
        save-position
      </button>
      <button type="button" onClick={onClose}>close-position</button>
    </div>
  ),
}))
vi.mock('./components/AddTradeModal', () => ({
  default: ({ onSave, onClose }) => (
    <div data-testid="add-trade-modal" role="dialog" aria-label="Add Trade">
      <button type="button" onClick={() => onSave({ symbol: 'NVDA', side: 'Long' })}>
        save-trade
      </button>
      <button type="button" onClick={onClose}>close-trade</button>
    </div>
  ),
}))

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

// Today is a heavy assembly surface (B1) with its own hook tree; this file is a
// routing test, so stub it to a marker — the index route resolving to the Today
// surface is what's under test here, not the surface internals.
vi.mock('./surfaces/TodaySurface', () => ({
  default: () => <div data-testid="today-surface" />,
}))

import JournalLayout, { HOTKEY_ROUTES } from './JournalLayout'
import TodaySurface from './surfaces/TodaySurface'
import TradesSurface from './surfaces/TradesSurface'
import CalendarSurface from './surfaces/CalendarSurface'
import NotebookSurface from './surfaces/NotebookSurface'
import JournalSurface from './surfaces/JournalSurface'
import InsightsSurface from './surfaces/InsightsSurface'
import CompassSurface from './surfaces/CompassSurface'
import CommunitySurface from './surfaces/CommunitySurface'
import AccountsSurface from './surfaces/AccountsSurface'
import { latchNotebookFlags } from './lib/offline/notebookFlags'

// ⛔ Wave 10 (10C, F-8): NotebookSurface now mounts Wave K's gate, which renders
// nothing until the capability flags latch (or its 3 s deadline passes). The REAL
// AuthContext latches them from /api/auth/me before AuthGuard renders any route;
// the AuthContext mocked above does not, so latch them here exactly as the real one
// would. The redirect assertions below are unchanged.
latchNotebookFlags({ notebook_offline_default_on: true })

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
          <Route path="calendar" element={<CalendarSurface />} />
          <Route path="notebook" element={<NotebookSurface />} />
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
  it('renders the 6 primary nav items as links (paid)', () => {
    renderAt('/journal')
    // Scope to the DESKTOP rail — the phone JournalMobileNav (B5) renders the
    // same section links (CSS-hidden on desktop, but present in jsdom), so a
    // bare getByRole would be ambiguous.
    const nav = screen.getByRole('navigation', { name: 'Journal sections' })
    for (const label of ['Today', 'Trades', 'Calendar', 'Notebook', 'Insights', 'Compass']) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('has no emoji in the nav', () => {
    renderAt('/journal')
    const nav = screen.getByRole('navigation', { name: 'Journal sections' })
    // Any pictographic / dingbat emoji would fail this — icons are inline SVG.
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
    expect(nav.textContent).not.toMatch(emoji)
    expect(nav.textContent).toBe('TodayTradesCalendarNotebookInsightsCompass')
  })
})

describe('JournalLayout — surfaces via nested routes', () => {
  it('the index route renders the Today surface', () => {
    renderAt('/journal')
    expect(screen.getByTestId('today-surface')).toBeInTheDocument()
  })

  it('navigating to Trades renders TradesSurface with the Open segment active', () => {
    renderAt('/journal')
    const nav = screen.getByRole('navigation', { name: 'Journal sections' })
    fireEvent.click(within(nav).getByRole('link', { name: 'Trades' }))
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
    // Scope to the desktop rail (the phone nav mirrors the same Compass entry).
    const nav = screen.getByRole('navigation', { name: 'Journal sections' })
    expect(within(nav).getByRole('link', { name: 'Compass' })).toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: 'Compass' })).not.toBeInTheDocument()
  })

  it('shows Compass as a present-but-disabled teaser when NOT paid (never hidden)', () => {
    renderAt('/journal', { paid: false })
    const nav = screen.getByRole('navigation', { name: 'Journal sections' })
    // Still present — never hidden from free users.
    expect(within(nav).getByText('Compass')).toBeInTheDocument()
    // Teaser is a disabled button, not a navigable link.
    const compass = within(nav).getByRole('button', { name: 'Compass' })
    expect(compass).toBeDisabled()
    expect(within(nav).queryByRole('link', { name: 'Compass' })).not.toBeInTheDocument()
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
    expect(screen.queryByTestId('today-surface')).not.toBeInTheDocument()
    // URL rewritten + ins= preserved + j2tab stripped (no loop).
    expect(screen.getByTestId('loc')).toHaveTextContent('/journal/insights?ins=edge')
  })

  it('/journal?j2tab=positions redirects to the Trades / Open segment', () => {
    renderAt('/journal?j2tab=positions')
    expect(screen.getByTestId('open-positions')).toBeInTheDocument()
    expect(screen.getByTestId('loc')).toHaveTextContent('/journal/trades?seg=open')
  })

  it('/journal?j2tab=notebook&note=abc redirects to the Notebook tab, preserving note', () => {
    renderAt('/journal?j2tab=notebook&note=abc')
    expect(screen.getByTestId('notebook')).toBeInTheDocument()
    const loc = screen.getByTestId('loc').textContent
    expect(loc).toContain('/journal/notebook')
    expect(loc).toContain('note=abc')
    expect(loc).not.toContain('seg=')
    expect(loc).not.toContain('j2tab')
  })

  it('/journal?j2tab=community redirects to the Community route', () => {
    renderAt('/journal?j2tab=community')
    expect(screen.getByTestId('community')).toBeInTheDocument()
    expect(screen.getByTestId('loc')).toHaveTextContent('/journal/community')
  })

  it('plain /journal (no j2tab) does NOT redirect — Today renders', () => {
    renderAt('/journal')
    expect(screen.getByTestId('today-surface')).toBeInTheDocument()
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
    expect(HOTKEY_ROUTES['g>a']).toBe('/journal/calendar')
    expect(HOTKEY_ROUTES['g>n']).toBe('/journal/notebook')
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
    expect(screen.getByTestId('today-surface')).toBeInTheDocument()
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

// ── "+ Log Trade" header action (Task A5) ────────────────────────────────────
describe('JournalLayout — "+ Log Trade" header action (A5)', () => {
  it('renders a persistent "+ Log Trade" action in the header', () => {
    renderAt('/journal')
    expect(screen.getByRole('button', { name: /log trade/i })).toBeInTheDocument()
  })

  it('is present on every surface, not just Today', () => {
    renderAt('/journal/insights')
    expect(screen.getByRole('button', { name: /log trade/i })).toBeInTheDocument()
  })

  it('clicking "+ Log Trade" opens a menu with the two log choices', () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: /log trade/i }))
    const menu = screen.getByRole('menu', { name: /log a trade/i })
    expect(within(menu).getByRole('menuitem', { name: /open position/i })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /closed trade/i })).toBeInTheDocument()
  })

  // The two log dialogs load on demand (their chunk is fetched on the first open), so every
  // test below that opens one awaits it once.
  it('"Log open position" opens the AddPositionModal add flow', async () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: /log trade/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /open position/i }))
    expect(await screen.findByTestId('add-position-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('add-trade-modal')).not.toBeInTheDocument()
  })

  it('"Log closed trade" opens the AddTradeModal add flow', async () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: /log trade/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /closed trade/i }))
    expect(await screen.findByTestId('add-trade-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('add-position-modal')).not.toBeInTheDocument()
  })

  it('the add flow closes via the modal onClose', async () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: /log trade/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /open position/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'close-position' }))
    expect(screen.queryByTestId('add-position-modal')).not.toBeInTheDocument()
  })

  it('the Log Trade menu uses no emoji', () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: /log trade/i }))
    const menu = screen.getByRole('menu', { name: /log a trade/i })
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
    expect(menu.textContent).not.toMatch(emoji)
  })
})

// ── Community + Accounts relocated to the header overflow (Task A5) ───────────
describe('JournalLayout — Community/Accounts overflow (A5)', () => {
  it('keeps the primary nav at exactly the 6 sections (no Community/Accounts)', () => {
    renderAt('/journal')
    const nav = screen.getByRole('navigation', { name: 'Journal sections' })
    expect(nav.textContent).toBe('TodayTradesCalendarNotebookInsightsCompass')
    expect(within(nav).queryByText('Community')).not.toBeInTheDocument()
    expect(within(nav).queryByText('Accounts')).not.toBeInTheDocument()
  })

  it('the header exposes a "More" overflow trigger', () => {
    renderAt('/journal')
    expect(screen.getByRole('button', { name: /more/i })).toBeInTheDocument()
  })

  it('the overflow menu links to both Community and Accounts routes', () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(screen.getByRole('link', { name: /community/i })).toHaveAttribute(
      'href',
      '/journal/community',
    )
    expect(screen.getByRole('link', { name: /accounts/i })).toHaveAttribute(
      'href',
      '/journal/accounts',
    )
  })

  it('clicking Community in the overflow navigates to the Community route', () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    fireEvent.click(screen.getByRole('link', { name: /community/i }))
    expect(screen.getByTestId('community')).toBeInTheDocument()
    expect(loc()).toBe('/journal/community')
  })

  it('clicking Accounts in the overflow navigates to the Accounts route', () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    fireEvent.click(screen.getByRole('link', { name: /accounts/i }))
    expect(screen.getByTestId('accounts')).toBeInTheDocument()
    expect(loc()).toBe('/journal/accounts')
  })

  it('the overflow menu uses no emoji', () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: /more/i }))
    const menu = screen.getByTestId('j2-more-menu')
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
    expect(menu.textContent).not.toMatch(emoji)
  })
})

// ── Mobile section nav + quick-log FAB (Task B5) ─────────────────────────────
// Both are ALWAYS mounted and CSS-hidden on desktop (`@media (max-width:640px)`
// swaps the desktop rail for the phone nav; the FAB is display:none on desktop).
// jsdom applies no CSS, so both are present in the DOM here — assert presence +
// structure + that the add flow is wired.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u

describe('JournalLayout — mobile section nav (B5)', () => {
  it('mounts the phone JournalMobileNav alongside the desktop rail', () => {
    renderAt('/journal')
    expect(
      screen.getByRole('navigation', { name: 'Journal sections (mobile)' }),
    ).toBeInTheDocument()
  })

  it('the mobile nav carries all 6 sections', () => {
    renderAt('/journal')
    const mnav = screen.getByRole('navigation', { name: 'Journal sections (mobile)' })
    for (const label of ['Today', 'Trades', 'Calendar', 'Notebook', 'Insights', 'Compass']) {
      expect(within(mnav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('the desktop rail is the hide-on-phone class + the mobile nav is hide-on-desktop', () => {
    renderAt('/journal')
    const rail = screen.getByRole('navigation', { name: 'Journal sections' })
    const mnav = screen.getByRole('navigation', { name: 'Journal sections (mobile)' })
    // CSS-module local names survive in the generated class string.
    expect(rail.className).toContain('navDesktop')
    expect(mnav.className).toContain('mobileNav')
  })

  it('the mobile nav uses no emoji', () => {
    renderAt('/journal')
    const mnav = screen.getByRole('navigation', { name: 'Journal sections (mobile)' })
    expect(mnav.textContent).not.toMatch(EMOJI)
  })
})

describe('JournalLayout — mobile quick-log FAB (B5)', () => {
  it('mounts a phone quick-log FAB (distinct from the header "+ Log Trade")', () => {
    renderAt('/journal')
    const fab = screen.getByRole('button', { name: 'Log a trade' })
    expect(fab).toBeInTheDocument()
    // Its own fixed wrapper (CSS-hidden on desktop) — not the header pill.
    expect(fab.parentElement.className).toContain('logFab')
  })

  it('is present on every surface, not just Today', () => {
    renderAt('/journal/insights')
    expect(screen.getByRole('button', { name: 'Log a trade' })).toBeInTheDocument()
  })

  it('opens a two-choice add menu that opens the AddPositionModal add flow', async () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: 'Log a trade' }))
    const menu = screen.getByRole('menu', { name: /quick log a trade/i })
    expect(within(menu).getByRole('menuitem', { name: /open position/i })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /open position/i }))
    expect(await screen.findByTestId('add-position-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('add-trade-modal')).not.toBeInTheDocument()
  })

  it('the "Log closed trade" choice opens the AddTradeModal add flow', async () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: 'Log a trade' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /closed trade/i }))
    expect(await screen.findByTestId('add-trade-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('add-position-modal')).not.toBeInTheDocument()
  })

  it('the FAB + its menu use no emoji', () => {
    renderAt('/journal')
    const fab = screen.getByRole('button', { name: 'Log a trade' })
    expect(fab.textContent).not.toMatch(EMOJI)
    fireEvent.click(fab)
    const menu = screen.getByRole('menu', { name: /quick log a trade/i })
    expect(menu.textContent).not.toMatch(EMOJI)
  })
})

// ── Keyboard Shortcuts door (A2R-04) ─────────────────────────────────────────
// Second a11y review, 2026-10-01. The "Show keyboard shortcuts" button was
// reachable by Tab but Enter did nothing, and the documented "?" shortcut did
// nothing either (react-hotkeys-hook's own `event.code`-based matching never
// satisfies a hotkey string containing the literal "/" character — see the
// comment beside the `useHotkeys` call in JournalLayout.jsx for the traced
// mechanism). Both are fixed here; this block proves it with real key events.
describe('JournalLayout — keyboard shortcuts door (A2R-04)', () => {
  it('Enter on the "Show keyboard shortcuts" button opens the dialog', async () => {
    renderAt('/journal')
    const btn = screen.getByRole('button', { name: 'Show keyboard shortcuts' })
    btn.focus()
    fireEvent.keyDown(btn, { key: 'Enter' })
    expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()
  })

  it('Space on the "Show keyboard shortcuts" button opens the dialog', async () => {
    renderAt('/journal')
    const btn = screen.getByRole('button', { name: 'Show keyboard shortcuts' })
    btn.focus()
    fireEvent.keyDown(btn, { key: ' ' })
    expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()
  })

  it('a plain click still opens it too (regression)', () => {
    renderAt('/journal')
    fireEvent.click(screen.getByRole('button', { name: 'Show keyboard shortcuts' }))
    expect(screen.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()
  })

  it('the "?" shortcut opens the dialog from a settled, non-input focus', async () => {
    renderAt('/journal')
    expect(screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeNull()
    document.body.focus()
    // The real physical key a Shift+/ press reports — react-hotkeys-hook
    // matches on `code`, which is what the fix (`'shift+slash'`) depends on.
    // `key: '?'` is included because that is what a real browser ALSO reports
    // for this combination; the library ignores it for matching, but a test
    // that omitted it would not be a faithful replay of a real keydown.
    fireEvent.keyDown(document.body, { key: '?', code: 'Slash', shiftKey: true })
    expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()
  })

  it('the "?" shortcut does NOT fire while typing in a text field (2.1.4)', async () => {
    renderAt('/journal')
    // AccountSelector is stubbed; use the header's own Notebook surface entry
    // point instead — the Trades search-like inputs aren't mounted from
    // /journal directly, so reach for a real text input this layout renders
    // unconditionally: the mobile/desktop nav has none, so seed one via the
    // "+ Log Trade" > Add Position flow, which has real form fields.
    fireEvent.click(screen.getByRole('button', { name: /log trade/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /open position/i }))
    const modal = await screen.findByTestId('add-position-modal')
    // The stub modal has no text input of its own; build one in place is not
    // representative, so assert the inverse precisely against a real `?`
    // event targeted at an <input> that react-hotkeys-hook's own
    // `enableOnFormTags` default (off) must still exclude.
    const input = document.createElement('input')
    modal.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: '?', code: 'Slash', shiftKey: true })
    expect(screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeNull()
  })

  it('Escape closes it and focus returns to the button that opened it', async () => {
    renderAt('/journal')
    const opener = screen.getByRole('button', { name: 'Show keyboard shortcuts' })
    opener.focus()
    fireEvent.keyDown(opener, { key: 'Enter' })
    await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })
})
