/**
 * Journal 2.0 — P4 nested-route shell (Task A2).
 *
 * Replaces the legacy 8-tab `?j2tab=` state machine (`JournalTwoRoot`, still
 * rendered by the kill-switch for `v8`) with a 5-item primary nav over nested
 * routes:
 *   Today `/journal` · Trades `/journal/trades` · Journal `/journal/journal`
 *   · Insights `/journal/insights` · Compass `/journal/compass` (paid-gated)
 *
 * The header pieces (AccountSelector, Generate Report, Settings gear, ?
 * shortcuts) + the consolidated modals carry over from `JournalTwoRoot`
 * verbatim. The active surface renders through <Outlet/>; `settings` (loaded
 * the same way JournalTwoRoot loads it) threads to the surfaces via Outlet
 * context so Trades/Journal can pass it to the existing tab components.
 *
 * The surfaces GROUP the existing tab components (Open Positions + Trade
 * Journal → Trades segments; Calendar + Notebook → Journal segments; Analytics
 * → Insights; Compass → Compass) — they are NOT rewritten here. Deep
 * content-merge (single unified table, server pagination) is P5 ("nav moves
 * once").
 */

import { Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import UIcon from '../../components/ui/UIcon'
import { useIsPaid } from '../../context/AuthContext'
import useJ2Settings from './hooks/useJ2Settings'
import useBrokerSync from './hooks/useBrokerSync'
import { mapJ2TabToRoute } from './j2tabRedirect'
import J2PriceProvider from './J2PriceProvider'
import { runJ2LocalStorageMigrations } from './lib/localStorageMigrate'
import PortfolioSettingsModal from './components/PortfolioSettingsModal'
import AccountSelector from './components/accounts/AccountSelector'
import NewAccountModal from './components/accounts/NewAccountModal'
import GenerateReportModal from './components/GenerateReportModal'
import ShortcutCheatSheet from './components/ShortcutCheatSheet'
import LogTradeButton from './LogTradeButton'
import JournalMobileNav from './JournalMobileNav'
import JournalLogFab from './JournalLogFab'
import TrialBanner from './components/TrialBanner'
import styles from './JournalLayout.module.css'

// The 5 primary surfaces. Compass is `paidOnly` — shown always (never hidden;
// Free tier sees a designed teaser, per spec §61), disabled + lock glyph when
// the user isn't paid. Community + Accounts are reachable routes but NOT
// primary nav items (they live in the header/overflow — A5 refines them).
const PRIMARY_NAV = [
  { to: '/journal', label: 'Today', icon: 'sun', end: true },
  { to: '/journal/trades', label: 'Trades', icon: 'equity' },
  { to: '/journal/journal', label: 'Journal', icon: 'journal' },
  { to: '/journal/insights', label: 'Insights', icon: 'chart' },
  { to: '/journal/compass', label: 'Compass', icon: 'compass', paidOnly: true },
]

// Legacy `g>` navigation chords (Task A4). The old 8-tab shell (JournalTwoRoot)
// bound these to setNestedTab(); under the v5 shell they alias to the new nested
// routes so muscle memory survives the 8→5 nav swap (spec §65). Each chord maps
// to the surface that replaced its old tab, preserving the segment where the tab
// became a segmented surface (`positions`→Trades/Open, `journal`→Trades/Closed,
// `calendar`/`notebook`→Journal segments). `g>o` ("o" for the Today overview) is
// a NEW primary alias for the Today landing that the old shell never had.
// Exported as a pure map so the chord→route wiring is unit-testable in isolation.
export const HOTKEY_ROUTES = {
  'g>o': '/journal', // Today (overview) — NEW primary alias
  'g>p': '/journal/trades?seg=open', // Open Positions (was `positions`)
  'g>j': '/journal/trades?seg=closed', // Closed Trades (was `journal`)
  'g>a': '/journal/journal?seg=calendar', // Calendar
  'g>n': '/journal/journal?seg=notebook', // Notebook
  'g>y': '/journal/insights', // Insights (was `analytics`)
  'g>t': '/journal/accounts', // Accounts
  'g>k': '/journal/compass', // Compass (paid-gated — see PAID_HOTKEY_CHORDS)
  'g>c': '/journal/community', // Community
}

// Chords whose destination is paid-only. A free user firing one is a no-op
// (mirrors the disabled Compass nav teaser — never routes to a blank surface).
export const PAID_HOTKEY_CHORDS = new Set(['g>k'])

export default function JournalLayout() {
  const isPaid = useIsPaid()
  // Best-effort refresh of broker-synced trades when the journal opens
  // (server-side cooldown keeps it cheap; no-op if broker sync unconfigured).
  useBrokerSync()
  const { settings, isLoading, error, save, accountName, isAllAccounts } = useJ2Settings()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [showSettings, setShowSettings] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showNewAccount, setShowNewAccount] = useState(false)
  const [showReport, setShowReport] = useState(false)
  // Header overflow: Community + Accounts are NOT primary nav items (A5) — they
  // live here so the primary rail stays exactly 5. The routes still exist (A2).
  const [showMore, setShowMore] = useState(false)

  const openSettings = useCallback(() => setShowSettings(true), [])
  const closeSettings = useCallback(() => setShowSettings(false), [])

  // One-shot, flag-gated localStorage migration (Task A6). No-op for P4 (surfaces
  // regroup the SAME components, so every pref key still resolves) — the real
  // column-merge migration lands in P5. Idempotent + non-destructive, so running
  // on every JournalLayout mount is safe.
  useEffect(() => {
    runJ2LocalStorageMigrations()
  }, [])

  // The `?` header button + Shift+? both open the cheat sheet (kept from
  // JournalTwoRoot).
  useHotkeys('shift+/', () => setShowShortcuts((x) => !x), { preventDefault: true })

  // Legacy `g>` chords → navigation aliases (Task A4). Each routes to the new
  // surface that replaced its old tab. useHotkeys must be called unconditionally
  // and in a stable order, so the chords are enumerated explicitly (one hook per
  // chord) rather than mapped over at render time. The handler resolves the route
  // from the pure HOTKEY_ROUTES map and honors the paid gate for Compass.
  const goToChord = useCallback(
    (chord) => {
      const to = HOTKEY_ROUTES[chord]
      if (!to) return
      if (PAID_HOTKEY_CHORDS.has(chord) && !isPaid) return // Compass stays locked
      navigate(to)
    },
    [navigate, isPaid],
  )
  useHotkeys('g>o', () => goToChord('g>o'))
  useHotkeys('g>p', () => goToChord('g>p'))
  useHotkeys('g>j', () => goToChord('g>j'))
  useHotkeys('g>a', () => goToChord('g>a'))
  useHotkeys('g>n', () => goToChord('g>n'))
  useHotkeys('g>y', () => goToChord('g>y'))
  useHotkeys('g>t', () => goToChord('g>t'))
  useHotkeys('g>k', () => goToChord('g>k'))
  useHotkeys('g>c', () => goToChord('g>c'))

  // Permanent `?j2tab=` redirect shim (Task A3). Under the v5 shell ONLY (v8's
  // JournalTwoRoot handles ?j2tab= natively), intercept any legacy deep-link and
  // Navigate to the mapped nested route, preserving the FULL querystring
  // (sc_* scope params, ins= sub-nav, note=, …). This runs BEFORE the Outlet
  // (Today) renders, so `/journal?j2tab=analytics` lands on /journal/insights
  // instead of flashing Today. No loop: the redirect target has no j2tab, so the
  // next render falls through to the normal shell. All hooks above are called
  // unconditionally — this is a conditional RETURN, not a conditional hook.
  if (searchParams.has('j2tab')) {
    const target = mapJ2TabToRoute(searchParams)
    if (target) return <Navigate to={`${target.path}${target.search}`} replace />
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Trade Journal</h1>
        <div className={styles.headerRight}>
          {/* Persistent "+ Log Trade" — the primary write affordance, on every
              surface (A5). Owns its own add-position / add-trade modals. */}
          <LogTradeButton />
          <button
            type="button"
            className={styles.shortcutsBtn}
            onClick={() => setShowShortcuts(true)}
            aria-label="Show keyboard shortcuts"
            title="Keyboard shortcuts (Shift + ?)"
          >
            <kbd className={styles.headerKbd}>?</kbd>
          </button>
          <AccountSelector onNewAccount={() => setShowNewAccount(true)} />
          <button
            type="button"
            className={styles.shortcutsBtn}
            onClick={() => setShowReport(true)}
            aria-label="Generate report"
            title="Generate Report (Ctrl/⌘+P after)"
          >
            <UIcon name="document" size={16} />
          </button>
          <button
            type="button"
            className={styles.settingsPill}
            onClick={openSettings}
            disabled={isLoading}
            aria-label="Open Portfolio Settings"
            title="Settings (current account)"
          >
            <span className={styles.gearIcon} aria-hidden="true"><UIcon name="gear" size={16} /></span>
          </button>

          {/* Overflow "More" — Community + Accounts (not primary nav; A5). Real
              <NavLink>s so they stay first-class routes, just off the main rail. */}
          <div className={styles.moreWrap}>
            <button
              type="button"
              className={styles.shortcutsBtn}
              onClick={() => setShowMore((x) => !x)}
              aria-haspopup="menu"
              aria-expanded={showMore}
              aria-label="More"
              title="More — Community, Accounts"
            >
              <UIcon name="more" size={16} />
            </button>
            {showMore && (
              <>
                <div
                  className={styles.menuBackdrop}
                  onClick={() => setShowMore(false)}
                  aria-hidden="true"
                />
                <div className={styles.menu} data-testid="j2-more-menu">
                  <NavLink
                    to="/journal/community"
                    className={styles.menuItem}
                    onClick={() => setShowMore(false)}
                  >
                    <UIcon name="community" size={14} aria-hidden="true" />
                    Community
                  </NavLink>
                  <NavLink
                    to="/journal/accounts"
                    className={styles.menuItem}
                    onClick={() => setShowMore(false)}
                  >
                    <UIcon name="user" size={14} aria-hidden="true" />
                    Accounts
                  </NavLink>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          Failed to load Journal 2.0 settings: {String(error.message || error)}
        </div>
      )}

      {/* trial notice — renders only for users inside their trial window
          (null for free/paid/admin). A single slim chip, not a new control band. */}
      <TrialBanner />

      <nav className={`${styles.nav} ${styles.navDesktop}`} aria-label="Journal sections">
        {PRIMARY_NAV.map((item) => {
          const locked = item.paidOnly && !isPaid
          if (locked) {
            // Teaser, not a link — shown (never hidden) but non-navigating
            // until upgraded. A disabled button keeps it in the a11y tree.
            return (
              <button
                key={item.to}
                type="button"
                disabled
                className={`${styles.navItem} ${styles.navItemLocked}`}
                data-locked="true"
                title="Compass — upgrade to unlock AI coaching"
              >
                <UIcon name={item.icon} size={16} />
                {item.label}
                <span className={styles.lockBadge} aria-hidden="true">
                  <UIcon name="lock" size={13} />
                </span>
              </button>
            )
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
              }
            >
              <UIcon name={item.icon} size={16} />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      {/* Phone section nav (Task B5): a top segmented scroller of the same 5
          surfaces, shown ONLY on phone (the desktop rail above hides via CSS).
          A TOP nav — NOT a second fixed bottom bar — so it never collides with
          the app-wide MobileTabBar. Always mounted; CSS decides where it shows. */}
      <JournalMobileNav />

      {/* Shared J2 price provider (Task A6): a STABLE base subscription to the
          browser-wide SSE pool for the current account's open positions, held
          across intra-journal surface switches (the provider mounts here, not
          per-surface, so navigating Today↔Trades↔Insights never rebuilds the
          socket). Additive — the tabs' own useRealtimePrices callers still work
          via the same pool; surfaces MAY read prices via useJ2Prices(). */}
      <J2PriceProvider>
        <div className={styles.content}>
          <Suspense fallback={<div className={styles.surfaceFallback}>Loading…</div>}>
            <Outlet context={{ settings }} />
          </Suspense>
        </div>
      </J2PriceProvider>

      {showSettings && settings && (
        <PortfolioSettingsModal
          settings={settings}
          onSave={save}
          onClose={closeSettings}
          accountName={accountName}
          isAllAccounts={isAllAccounts}
        />
      )}

      {showNewAccount && (
        <NewAccountModal onClose={() => setShowNewAccount(false)} />
      )}

      {showReport && (
        <GenerateReportModal onClose={() => setShowReport(false)} />
      )}

      <ShortcutCheatSheet open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Mobile quick-log FAB (Task B5): a phone-only fixed "+ Log" button that
          opens the same add flow as the header LogTradeButton. Placed clear of
          the global bottom bar + voice orb + feedback widget; CSS-hidden on
          desktop (the header pill serves). */}
      <JournalLogFab />
    </div>
  )
}
