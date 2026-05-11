/**
 * Journal 2.0 — root shell component.
 * Spec §6.
 *
 * Phase 2 scope: header (title + ⚙ Settings pill) + modal mount +
 * placeholder nested tabs. Tab content is filled by Phases 3 + 5.
 */

import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import useJ2Settings from './hooks/useJ2Settings'
import PortfolioSettingsModal from './components/PortfolioSettingsModal'
import OpenPositionsTab from './tabs/OpenPositionsTab'
import TradeJournalTab from './tabs/TradeJournalTab'
import CalendarTab from './tabs/CalendarTab'
import AccountsTab from './tabs/AccountsTab'
import AnalyticsTab from './tabs/AnalyticsTab'
import PlaybookTab from './tabs/PlaybookTab'
import CompassTab from './tabs/CompassTab'
import CommunityTab from './tabs/CommunityTab'
import AccountSelector from './components/accounts/AccountSelector'
import NewAccountModal from './components/accounts/NewAccountModal'
import GenerateReportModal from './components/GenerateReportModal'
import ShortcutCheatSheet from './components/ShortcutCheatSheet'
import { money } from '../../lib/journal-2-0'
import styles from './JournalTwoRoot.module.css'

const NESTED_TABS = [
  { key: 'positions', label: '📊 Open Positions' },
  { key: 'journal', label: '📒 Trade Journal' },
  { key: 'calendar', label: '📅 Calendar' },
  { key: 'accounts', label: '💼 Accounts' },
  { key: 'analytics', label: '📈 Analytics' },
  { key: 'playbook', label: '📚 Playbook' },
  { key: 'compass', label: '🧭 Compass' },
  { key: 'community', label: '🌐 Community' },
]

export default function JournalTwoRoot() {
  const { settings, isLoading, error, save, accountName, isAllAccounts } = useJ2Settings()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showSettings, setShowSettings] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const initialTab = searchParams.get('j2tab') || 'positions'
  const [nestedTab, setNestedTab] = useState(initialTab)

  // When the URL ?j2tab= changes (e.g. user navigates back from DayDetailPage),
  // reflect into local state.
  useEffect(() => {
    const fromUrl = searchParams.get('j2tab')
    if (fromUrl && fromUrl !== nestedTab) {
      setNestedTab(fromUrl)
    }
  }, [searchParams, nestedTab])

  // Mirror tab state back into URL so deep-links + back-nav work.
  useEffect(() => {
    if (searchParams.get('j2tab') !== nestedTab) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('j2tab', nestedTab)
        return next
      }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nestedTab])

  const openSettings = useCallback(() => setShowSettings(true), [])
  const closeSettings = useCallback(() => setShowSettings(false), [])

  // Global shortcuts
  useHotkeys('shift+/', () => setShowShortcuts((x) => !x), { preventDefault: true })
  useHotkeys('g>p', () => setNestedTab('positions'))
  useHotkeys('g>j', () => setNestedTab('journal'))
  useHotkeys('g>a', () => setNestedTab('calendar'))
  useHotkeys('g>t', () => setNestedTab('accounts'))
  useHotkeys('g>y', () => setNestedTab('analytics'))
  useHotkeys('g>b', () => setNestedTab('playbook'))
  useHotkeys('g>k', () => setNestedTab('compass'))
  useHotkeys('g>c', () => setNestedTab('community'))

  const [showNewAccount, setShowNewAccount] = useState(false)
  const [showReport, setShowReport] = useState(false)

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Journal 2.0</h1>
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
            📄
          </button>
          <button
            type="button"
            className={styles.settingsPill}
            onClick={openSettings}
            disabled={isLoading}
            aria-label="Open Portfolio Settings"
            title="Settings (current account)"
          >
            <span className={styles.gearIcon} aria-hidden="true">⚙</span>
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          Failed to load Journal 2.0 settings: {String(error.message || error)}
        </div>
      )}

      <div className={styles.nestedTabBar} role="tablist" aria-label="Journal 2.0 views">
        {NESTED_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={nestedTab === tab.key}
            className={`${styles.nestedTab} ${
              nestedTab === tab.key ? styles.nestedTabActive : ''
            }`}
            onClick={() => setNestedTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {nestedTab === 'positions' && (
          <OpenPositionsTab
            settings={settings}
            onTradeWritten={() => setNestedTab('journal')}
          />
        )}
        {nestedTab === 'journal' && <TradeJournalTab settings={settings} />}
        {nestedTab === 'calendar' && <CalendarTab />}
        {nestedTab === 'accounts' && (
          <AccountsTab onNewAccount={() => setShowNewAccount(true)} />
        )}
        {nestedTab === 'analytics' && <AnalyticsTab />}
        {nestedTab === 'playbook' && <PlaybookTab />}
        {nestedTab === 'compass' && <CompassTab />}
        {nestedTab === 'community' && <CommunityTab />}
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
