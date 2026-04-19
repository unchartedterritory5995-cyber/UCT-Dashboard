/**
 * Journal 2.0 — root shell component.
 * Spec §6.
 *
 * Phase 2 scope: header (title + ⚙ Settings pill) + modal mount +
 * placeholder nested tabs. Tab content is filled by Phases 3 + 5.
 */

import { useState, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import useJ2Settings from './hooks/useJ2Settings'
import PortfolioSettingsModal from './components/PortfolioSettingsModal'
import OpenPositionsTab from './tabs/OpenPositionsTab'
import TradeJournalTab from './tabs/TradeJournalTab'
import CalendarTab from './tabs/CalendarTab'
import CommunityTab from './tabs/CommunityTab'
import ShortcutCheatSheet from './components/ShortcutCheatSheet'
import { money } from '../../lib/journal-2-0'
import styles from './JournalTwoRoot.module.css'

const NESTED_TABS = [
  { key: 'positions', label: '📊 Open Positions' },
  { key: 'journal', label: '📒 Trade Journal' },
  { key: 'calendar', label: '📅 Calendar' },
  { key: 'community', label: '🌐 Community' },
]

export default function JournalTwoRoot() {
  const { settings, isLoading, error, save } = useJ2Settings()
  const [showSettings, setShowSettings] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [nestedTab, setNestedTab] = useState('positions')

  const openSettings = useCallback(() => setShowSettings(true), [])
  const closeSettings = useCallback(() => setShowSettings(false), [])

  // Global shortcuts
  useHotkeys('shift+/', () => setShowShortcuts((x) => !x), { preventDefault: true })
  useHotkeys('g>p', () => setNestedTab('positions'))
  useHotkeys('g>j', () => setNestedTab('journal'))
  useHotkeys('g>a', () => setNestedTab('calendar'))
  useHotkeys('g>c', () => setNestedTab('community'))

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
          <button
            type="button"
            className={styles.settingsPill}
            onClick={openSettings}
            disabled={isLoading}
            aria-label="Open Portfolio Settings"
          >
            <span className={styles.gearIcon} aria-hidden="true">⚙</span>
            <span className={styles.pillLabel}>Settings</span>
            {settings && (
              <span className={styles.pillValue}>{money(settings.accountSize)}</span>
            )}
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
        {nestedTab === 'community' && <CommunityTab />}
      </div>

      {showSettings && settings && (
        <PortfolioSettingsModal
          settings={settings}
          onSave={save}
          onClose={closeSettings}
        />
      )}

      <ShortcutCheatSheet open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  )
}
