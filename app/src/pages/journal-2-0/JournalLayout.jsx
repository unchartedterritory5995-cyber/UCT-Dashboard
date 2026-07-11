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

import { Suspense, useCallback, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import UIcon from '../../components/ui/UIcon'
import { useIsPaid } from '../../context/AuthContext'
import useJ2Settings from './hooks/useJ2Settings'
import useBrokerSync from './hooks/useBrokerSync'
import PortfolioSettingsModal from './components/PortfolioSettingsModal'
import AccountSelector from './components/accounts/AccountSelector'
import NewAccountModal from './components/accounts/NewAccountModal'
import GenerateReportModal from './components/GenerateReportModal'
import ShortcutCheatSheet from './components/ShortcutCheatSheet'
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

export default function JournalLayout() {
  const isPaid = useIsPaid()
  // Best-effort refresh of broker-synced trades when the journal opens
  // (server-side cooldown keeps it cheap; no-op if broker sync unconfigured).
  useBrokerSync()
  const { settings, isLoading, error, save, accountName, isAllAccounts } = useJ2Settings()

  const [showSettings, setShowSettings] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showNewAccount, setShowNewAccount] = useState(false)
  const [showReport, setShowReport] = useState(false)

  const openSettings = useCallback(() => setShowSettings(true), [])
  const closeSettings = useCallback(() => setShowSettings(false), [])

  // The `?` header button + Shift+? both open the cheat sheet (kept from
  // JournalTwoRoot). The g> navigation chords are Task A4.
  useHotkeys('shift+/', () => setShowShortcuts((x) => !x), { preventDefault: true })

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Trade Journal</h1>
        <div className={styles.headerRight}>
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
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          Failed to load Journal 2.0 settings: {String(error.message || error)}
        </div>
      )}

      <nav className={styles.nav} aria-label="Journal sections">
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

      <div className={styles.content}>
        <Suspense fallback={<div className={styles.surfaceFallback}>Loading…</div>}>
          <Outlet context={{ settings }} />
        </Suspense>
      </div>

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
    </div>
  )
}
