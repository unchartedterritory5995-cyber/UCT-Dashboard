/**
 * Journal 2.0 — P4 test gate (Task B7): the whole-nav-swap regression guard.
 *
 * The 8→5 nav restructure (A1–A6 + B1–B6) rewired the journal onto nested
 * routes behind a runtime kill-switch, with a permanent `?j2tab=` redirect shim,
 * `g>` hotkey aliases, and a one-shot localStorage migration. This is the single
 * deterministic jsdom+MemoryRouter integration test that fails if ANY of those
 * four surfaces breaks:
 *
 *   1. Redirect matrix — every one of the 9 legacy `?j2tab=` consumer forms lands
 *      on the correct new route with its FULL querystring preserved (asserted
 *      both as the pure `mapJ2TabToRoute` mapping AND end-to-end through the REAL
 *      JournalLayout <Navigate> so the shim is proven to fire).
 *   2. Hotkey drill — the exported `g>` chord→route map is complete + correct, the
 *      paid-gate set is right, and a couple chords are driven live to prove the
 *      map is actually wired to navigation.
 *   3. localStorage migration — idempotent (twice = no-op), sets the version flag,
 *      preserves existing `uct.j2.*` prefs.
 *   4. Kill-switch drill — `resolveJ2Shell()` is dark (v8) at rollout 0 / unset,
 *      the explicit v5/v8 overrides win, and the shell selector (the App.jsx seam,
 *      reconstructed over the REAL `useJ2Shell`) swaps the new JournalLayout shell
 *      in for v5 and the legacy shell for v8 — reversible at runtime, no reload.
 *
 * Heavy surfaces/tabs are stubbed to identifiable markers (the mock set mirrors
 * the proven-green JournalLayout.test.jsx) so this test is about ROUTING /
 * REDIRECT / HOTKEY / KILL-SWITCH, not the heavy component internals — but it
 * drives the REAL JournalLayout + shellFlag + j2tabRedirect + localStorageMigrate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

// ── controllable paid state ──────────────────────────────────────────────────
let mockIsPaid = true
vi.mock('../../../context/AuthContext', () => ({
  useIsPaid: () => mockIsPaid,
  useAuth: () => ({ isPaid: mockIsPaid }),
}))

// ── shell hooks / header pieces / modals (stubbed — routing is under test) ────
vi.mock('../hooks/useJ2Settings', () => ({
  default: () => ({
    settings: { setups: [] },
    isLoading: false,
    error: null,
    save: vi.fn(),
    accountName: 'Default',
    isAllAccounts: false,
  }),
}))
vi.mock('../hooks/useBrokerSync', () => ({ default: () => {} }))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: 'a1',
    account: { id: 'a1', name: 'Default' },
    accounts: [{ id: 'a1', name: 'Default' }],
    setAccount: vi.fn(),
    isLoading: false,
  }),
}))
vi.mock('../components/accounts/AccountSelector', () => ({
  default: () => <div data-testid="account-selector" />,
}))
vi.mock('../components/PortfolioSettingsModal', () => ({ default: () => null }))
vi.mock('../components/accounts/NewAccountModal', () => ({ default: () => null }))
vi.mock('../components/GenerateReportModal', () => ({ default: () => null }))
vi.mock('../components/ShortcutCheatSheet', () => ({ default: () => null }))
vi.mock('../components/AddPositionModal', () => ({
  default: ({ onClose }) => (
    <div data-testid="add-position-modal" role="dialog" aria-label="Add Position">
      <button type="button" onClick={onClose}>close-position</button>
    </div>
  ),
}))
vi.mock('../components/AddTradeModal', () => ({
  default: ({ onClose }) => (
    <div data-testid="add-trade-modal" role="dialog" aria-label="Add Trade">
      <button type="button" onClick={onClose}>close-trade</button>
    </div>
  ),
}))

// ── heavy tab components the surfaces host (simple identifiable stubs) ─────────
vi.mock('../tabs/OpenPositionsTab', () => ({ default: () => <div data-testid="open-positions" /> }))
vi.mock('../tabs/TradeJournalTab', () => ({ default: () => <div data-testid="trade-journal" /> }))
vi.mock('../tabs/CalendarTab', () => ({ default: () => <div data-testid="calendar" /> }))
vi.mock('../tabs/NotebookTab', () => ({ default: () => <div data-testid="notebook" /> }))
vi.mock('../tabs/AnalyticsTab', () => ({ default: () => <div data-testid="analytics" /> }))
vi.mock('../tabs/CompassTab', () => ({ default: () => <div data-testid="compass" /> }))
vi.mock('../tabs/CommunityTab', () => ({ default: () => <div data-testid="community" /> }))
vi.mock('../tabs/AccountsTab', () => ({ default: () => <div data-testid="accounts" /> }))

// Today is a heavy assembly surface (B1); this is a routing test, so stub it to a
// marker — the index route resolving to Today is what's under test, not internals.
vi.mock('../surfaces/TodaySurface', () => ({
  default: () => <div data-testid="today-surface" />,
}))

// ── real modules under test ──────────────────────────────────────────────────
import JournalLayout, { HOTKEY_ROUTES, PAID_HOTKEY_CHORDS } from '../JournalLayout'
import { mapJ2TabToRoute } from '../j2tabRedirect'
import {
  J2_SHELL_ROLLOUT_PCT,
  resolveJ2Shell,
  setJ2Shell,
  useJ2Shell,
} from '../shellFlag'
import {
  runJ2LocalStorageMigrations,
  J2_MIGRATION_FLAG,
} from '../lib/localStorageMigrate'
import TodaySurface from '../surfaces/TodaySurface'
import TradesSurface from '../surfaces/TradesSurface'
import JournalSurface from '../surfaces/JournalSurface'
import InsightsSurface from '../surfaces/InsightsSurface'
import CompassSurface from '../surfaces/CompassSurface'
import CommunitySurface from '../surfaces/CommunitySurface'
import AccountsSurface from '../surfaces/AccountsSurface'

// ── helpers ──────────────────────────────────────────────────────────────────

// Probe that surfaces the live location so post-Navigate URLs can be read.
function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{`${loc.pathname}${loc.search}`}</div>
}

// The 5 nested child routes under the v5 shell — mirrors App.jsx exactly.
function journalRoutes() {
  return (
    <Route path="/journal" element={<JournalLayout />}>
      <Route index element={<TodaySurface />} />
      <Route path="trades" element={<TradesSurface />} />
      <Route path="journal" element={<JournalSurface />} />
      <Route path="insights" element={<InsightsSurface />} />
      <Route path="compass" element={<CompassSurface />} />
      <Route path="community" element={<CommunitySurface />} />
      <Route path="accounts" element={<AccountsSurface />} />
    </Route>
  )
}

function renderJournalAt(route, { paid = true } = {}) {
  mockIsPaid = paid
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LocationProbe />
      <Routes>{journalRoutes()}</Routes>
    </MemoryRouter>,
  )
}

// Turn a querystring (with or without leading '?') into a plain object so param
// assertions are order-independent + exact (a stray/dropped param fails).
function searchToObj(search) {
  const o = {}
  for (const [k, v] of new URLSearchParams(search).entries()) o[k] = v
  return o
}

// The canonical 9-form redirect matrix (the 9 legacy `?j2tab=` consumer forms).
// `path` = destination pathname; `params` = the EXACT expected query params after
// redirect (seg injected for segmented surfaces, sc_*/ins/note preserved verbatim,
// j2tab stripped); `surface` = the marker that must render post-redirect.
const REDIRECT_MATRIX = [
  { name: 'positions',        query: 'j2tab=positions',                    path: '/journal/trades',    params: { seg: 'open' },                          surface: 'open-positions' },
  { name: 'journal',          query: 'j2tab=journal',                      path: '/journal/trades',    params: { seg: 'closed' },                        surface: 'trade-journal' },
  { name: 'calendar',         query: 'j2tab=calendar',                     path: '/journal/journal',   params: { seg: 'calendar' },                      surface: 'calendar' },
  { name: 'notebook+note',    query: 'j2tab=notebook&note=abc',            path: '/journal/journal',   params: { seg: 'notebook', note: 'abc' },         surface: 'notebook' },
  { name: 'analytics+ins',    query: 'j2tab=analytics&ins=edge',           path: '/journal/insights',  params: { ins: 'edge' },                          surface: 'analytics' },
  { name: 'journal+sc_*',     query: 'j2tab=journal&sc_setup=VCP&sc_v=1',  path: '/journal/trades',    params: { seg: 'closed', sc_setup: 'VCP', sc_v: '1' }, surface: 'trade-journal' },
  { name: 'accounts',         query: 'j2tab=accounts',                     path: '/journal/accounts',  params: {},                                       surface: 'accounts' },
  { name: 'compass',          query: 'j2tab=compass',                      path: '/journal/compass',   params: {},                                       surface: 'compass' },
  { name: 'community',        query: 'j2tab=community',                    path: '/journal/community', params: {},                                       surface: 'community' },
]

beforeEach(() => {
  mockIsPaid = true
  try { localStorage.clear() } catch { /* ignore */ }
})

// ── 1. REDIRECT MATRIX ───────────────────────────────────────────────────────

describe('P4 gate · 1. redirect matrix — pure mapJ2TabToRoute (all 9 forms)', () => {
  it.each(REDIRECT_MATRIX)(
    'j2tab=$name maps to $path with the querystring preserved',
    ({ query, path, params }) => {
      const result = mapJ2TabToRoute(new URLSearchParams(query))
      expect(result).not.toBeNull()
      expect(result.path).toBe(path)
      // Exact param set (order-independent): seg injected, sc_*/ins/note kept,
      // j2tab stripped. A dropped or leaked param fails this.
      expect(searchToObj(result.search)).toEqual(params)
      expect(result.search).not.toContain('j2tab')
    },
  )

  it('returns null when there is no j2tab (no redirect on a bare /journal)', () => {
    expect(mapJ2TabToRoute(new URLSearchParams(''))).toBeNull()
    expect(mapJ2TabToRoute(new URLSearchParams('seg=open'))).toBeNull()
  })

  it('covers exactly the 9 documented consumer forms', () => {
    expect(REDIRECT_MATRIX).toHaveLength(9)
  })
})

describe('P4 gate · 1. redirect matrix — end-to-end through the REAL router', () => {
  it.each(REDIRECT_MATRIX)(
    '/journal?$query fires <Navigate> → $path (querystring preserved, correct surface)',
    ({ query, path, params, surface }) => {
      renderJournalAt(`/journal?${query}`)

      // The redirect fired end-to-end: the target surface rendered, NOT Today.
      expect(screen.getByTestId(surface)).toBeInTheDocument()
      expect(screen.queryByTestId('today-surface')).not.toBeInTheDocument()

      // The resolved location: pathname + preserved params, j2tab gone (no loop).
      const [pathname, rawQuery = ''] = screen.getByTestId('loc').textContent.split('?')
      expect(pathname).toBe(path)
      expect(searchToObj(rawQuery)).toEqual(params)
      expect(rawQuery).not.toContain('j2tab')
    },
  )

  it('a bare /journal (no j2tab) does NOT redirect — Today renders in place', () => {
    renderJournalAt('/journal')
    expect(screen.getByTestId('today-surface')).toBeInTheDocument()
    expect(screen.getByTestId('loc')).toHaveTextContent('/journal')
  })
})

// ── 2. HOTKEY DRILL ──────────────────────────────────────────────────────────

// react-hotkeys-hook v5 reads event.code for sequence chords (KeyG → 'g'); firing
// g then <key> drives the chord synchronously (JournalLayout.test.jsx precedent).
function pressChord(secondCode) {
  fireEvent.keyDown(document.body, { code: 'KeyG' })
  fireEvent.keyDown(document.body, { code: secondCode })
}
const loc = () => screen.getByTestId('loc').textContent

describe('P4 gate · 2. hotkey drill — the g> chord→route map', () => {
  it('HOTKEY_ROUTES is the complete, correct 9-chord map (incl. the new g>o Today alias)', () => {
    expect(HOTKEY_ROUTES).toEqual({
      'g>o': '/journal',
      'g>p': '/journal/trades?seg=open',
      'g>j': '/journal/trades?seg=closed',
      'g>a': '/journal/journal?seg=calendar',
      'g>n': '/journal/journal?seg=notebook',
      'g>y': '/journal/insights',
      'g>t': '/journal/accounts',
      'g>k': '/journal/compass',
      'g>c': '/journal/community',
    })
  })

  it('PAID_HOTKEY_CHORDS gates exactly the Compass chord (g>k)', () => {
    expect(PAID_HOTKEY_CHORDS.has('g>k')).toBe(true)
    // Only Compass is paid-gated — no other chord routes to a locked surface.
    expect([...PAID_HOTKEY_CHORDS]).toEqual(['g>k'])
  })

  it('every chord target resolves to a real /journal route', () => {
    for (const route of Object.values(HOTKEY_ROUTES)) {
      expect(route.startsWith('/journal')).toBe(true)
    }
  })

  it('g>y is wired to navigation → lands on Insights', () => {
    renderJournalAt('/journal')
    pressChord('KeyY')
    expect(loc()).toBe('/journal/insights')
    expect(screen.getByTestId('analytics')).toBeInTheDocument()
  })

  it('g>c is wired → lands on Community', () => {
    renderJournalAt('/journal')
    pressChord('KeyC')
    expect(loc()).toBe('/journal/community')
    expect(screen.getByTestId('community')).toBeInTheDocument()
  })

  it('g>k routes to Compass when paid (paid gate wired)', () => {
    renderJournalAt('/journal', { paid: true })
    pressChord('KeyK')
    expect(loc()).toBe('/journal/compass')
  })

  it('g>k is a no-op for free users (Compass stays locked)', () => {
    renderJournalAt('/journal', { paid: false })
    pressChord('KeyK')
    expect(loc()).toBe('/journal') // stayed put — Compass locked
  })
})

// ── 3. localStorage MIGRATION ────────────────────────────────────────────────

describe('P4 gate · 3. localStorage migration — idempotent + non-destructive', () => {
  it('runs exactly once (first = migrate, subsequent = no-op) and sets the v4 flag', () => {
    expect(localStorage.getItem(J2_MIGRATION_FLAG)).toBeNull()
    expect(runJ2LocalStorageMigrations()).toBe(true)   // performed
    expect(localStorage.getItem(J2_MIGRATION_FLAG)).toBe('1')
    expect(runJ2LocalStorageMigrations()).toBe(false)  // already migrated
    expect(runJ2LocalStorageMigrations()).toBe(false)
  })

  it('preserves existing uct.j2.* prefs across the migration', () => {
    const seed = {
      'uct.j2.selectedAccountId': 'acc-123',
      'uct.j2.openPositions.columns': JSON.stringify({ order: ['symbol'], hidden: [] }),
      'uct.j2.tradeJournal.columns': JSON.stringify({ order: ['symbol'], hidden: [] }),
      'uct.j2.calendar.mode': 'month',
      'uct.j2.holdings.sort': 'symbol:asc',
    }
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v)

    runJ2LocalStorageMigrations()
    runJ2LocalStorageMigrations() // idempotent second pass

    for (const [k, v] of Object.entries(seed)) {
      expect(localStorage.getItem(k)).toBe(v) // survives byte-for-byte
    }
    expect(localStorage.getItem(J2_MIGRATION_FLAG)).toBe('1')
  })
})

// ── 4. KILL-SWITCH DRILL ─────────────────────────────────────────────────────

// The App.jsx seam (JournalShellSelector) is not exported, so this reconstructs
// the identical 1-line kill-switch over the REAL useJ2Shell hook: v8 → legacy
// shell, v5 → the REAL new JournalLayout shell. It proves the flag hook drives
// the shell swap at runtime (same-tab, no reload) — the reversibility guarantee.
function ShellSelectorHarness() {
  const shell = useJ2Shell()
  if (shell === 'v8') {
    return <div data-testid="legacy-shell">legacy 8-tab shell</div>
  }
  return <Routes>{journalRoutes()}</Routes>
}

function renderSelector() {
  return render(
    <MemoryRouter initialEntries={['/journal']}>
      <ShellSelectorHarness />
    </MemoryRouter>,
  )
}

describe('P4 gate · 4. kill-switch drill — flag resolution', () => {
  it('ships DEFAULT-ON: rollout constant is 100 (new 5-surface shell for everyone)', () => {
    expect(J2_SHELL_ROLLOUT_PCT).toBe(100)
  })

  it("resolveJ2Shell() is 'v5' when unset at rollout 100 (new shell default)", () => {
    expect(localStorage.getItem('uct.j2.shell')).toBeNull()
    expect(resolveJ2Shell()).toBe('v5')
  })

  it("the kill-switch still forces legacy: setJ2Shell('v8') → 'v8' even at rollout 100", () => {
    setJ2Shell('v8')
    expect(resolveJ2Shell()).toBe('v8')
  })

  it("explicit overrides win: setJ2Shell('v5') → 'v5', setJ2Shell('v8') → 'v8'", () => {
    setJ2Shell('v5')
    expect(resolveJ2Shell()).toBe('v5')
    setJ2Shell('v8')
    expect(resolveJ2Shell()).toBe('v8')
  })

  it('an invalid value is a no-op (never corrupts the flag)', () => {
    setJ2Shell('v5')
    setJ2Shell('nonsense')
    expect(resolveJ2Shell()).toBe('v5')
  })
})

describe('P4 gate · 4. kill-switch drill — selector swaps the shell at runtime', () => {
  it('renders the LEGACY shell for v8 and the NEW JournalLayout shell for v5, live', () => {
    // Force the legacy shell explicitly (the kill-switch escape hatch) → v8 → legacy
    // shell; the new shell is absent. (Independent of the rollout default, which is 100.)
    setJ2Shell('v8')
    renderSelector()
    expect(screen.getByTestId('legacy-shell')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Journal sections' })).not.toBeInTheDocument()

    // Flip to v5 in-tab (no reload) → the REAL new nested-route shell mounts.
    act(() => setJ2Shell('v5'))
    const nav = screen.getByRole('navigation', { name: 'Journal sections' })
    for (const label of ['Today', 'Trades', 'Journal', 'Insights', 'Compass']) {
      expect(within(nav).getByText(label)).toBeInTheDocument()
    }
    expect(screen.queryByTestId('legacy-shell')).not.toBeInTheDocument()

    // Flip back to v8 → instant revert to the legacy shell.
    act(() => setJ2Shell('v8'))
    expect(screen.getByTestId('legacy-shell')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Journal sections' })).not.toBeInTheDocument()
  })
})
