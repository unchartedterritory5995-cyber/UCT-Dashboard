/**
 * Journal 2.0 — root shell component.
 * Spec §6.
 *
 * Phase 2 scope: header (title + ⚙ Settings pill) + modal mount +
 * placeholder nested tabs. Tab content is filled by Phases 3 + 5.
 */

import { useState, useCallback } from 'react'
import useJ2Settings from './hooks/useJ2Settings'
import useJ2Trades from './hooks/useJ2Trades'
import PortfolioSettingsModal from './components/PortfolioSettingsModal'
import OpenPositionsTab from './tabs/OpenPositionsTab'
import { money } from '../../lib/journal-2-0'
import styles from './JournalTwoRoot.module.css'

const NESTED_TABS = [
  { key: 'positions', label: '📊 Open Positions' },
  { key: 'journal', label: '📒 Trade Journal' },
]

export default function JournalTwoRoot() {
  const { settings, isLoading, error, save } = useJ2Settings()
  const { trades } = useJ2Trades()
  const [showSettings, setShowSettings] = useState(false)
  const [nestedTab, setNestedTab] = useState('positions')

  const openSettings = useCallback(() => setShowSettings(true), [])
  const closeSettings = useCallback(() => setShowSettings(false), [])

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Journal 2.0</h1>
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
        {nestedTab === 'journal' && (
          <div className={styles.placeholder}>
            {trades.length === 0 ? (
              <p>No trades recorded yet. Close a position from the Open Positions tab to write the first one.</p>
            ) : (
              <>
                <p>
                  {trades.length} trade{trades.length === 1 ? '' : 's'} recorded.
                </p>
                <p className={styles.placeholderHint}>
                  Full Trade Journal view with 12 stat cards and filters arrives in Phase 5.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {showSettings && settings && (
        <PortfolioSettingsModal
          settings={settings}
          onSave={save}
          onClose={closeSettings}
        />
      )}
    </div>
  )
}
