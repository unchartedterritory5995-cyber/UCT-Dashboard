// app/src/pages/journal/JournalPage.jsx
import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import usePreferences from '../../hooks/usePreferences'
import TradeLog from './tabs/TradeLog'
import DailyNotes from './tabs/DailyNotes'
import CalendarReview from './tabs/CalendarReview'
import Overview from './tabs/Overview'
import ReviewQueue from './tabs/ReviewQueue'
import Analytics from './tabs/Analytics'
import Playbooks from './tabs/Playbooks'
import TradeDrawer from './components/TradeDrawer'
import TradeForm from './components/TradeForm'
import styles from './JournalPage.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const JOURNAL_TABS = [
  { key: 'log', label: 'Trade Log' },
  { key: 'overview', label: 'Overview' },
  { key: 'daily', label: 'Daily Notes' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'playbooks', label: 'Playbooks' },
  { key: 'queue', label: 'Review Queue' },
]

export default function JournalPage() {
  const { prefs, setPref } = usePreferences()
  const [activeTab, setActiveTab] = useState(prefs.journal_tab || 'overview')
  const [drawerTradeId, setDrawerTradeId] = useState(null)
  const [showNewForm, setShowNewForm] = useState(false)

  const { data: stats, mutate: mutateStats } = useSWR('/api/journal/stats', fetcher, {
    refreshInterval: 60000,
    dedupingInterval: 30000,
    revalidateOnFocus: false,
  })

  // Persist active tab
  useEffect(() => {
    if (prefs.journal_tab !== activeTab) {
      setPref('journal_tab', activeTab)
    }
  }, [activeTab])

  // Sync from prefs on mount
  useEffect(() => {
    if (prefs.journal_tab && prefs.journal_tab !== activeTab) {
      setActiveTab(prefs.journal_tab)
    }
  }, [])

  // Filter state for cross-tab navigation (e.g., Overview chips → Trade Log)
  const [logFilter, setLogFilter] = useState(null)

  const handleTabChange = useCallback((key) => {
    setActiveTab(key)
    setShowNewForm(false)
    setLogFilter(null)
  }, [])

  // Switch tab with optional filter (used by Overview shortcuts)
  const handleSwitchTab = useCallback((tabKey, filter) => {
    setActiveTab(tabKey)
    setShowNewForm(false)
    if (filter) {
      setLogFilter(filter)
    } else {
      setLogFilter(null)
    }
  }, [])

  const handleOpenTrade = useCallback((tradeId) => {
    setDrawerTradeId(tradeId)
  }, [])

  const handleCloseDrawer = useCallback(() => {
    setDrawerTradeId(null)
  }, [])

  const handleNewTrade = useCallback(() => {
    setShowNewForm(prev => !prev)
    setDrawerTradeId(null)
  }, [])

  const handleTradeCreated = useCallback(() => {
    setShowNewForm(false)
    mutateStats()
  }, [mutateStats])

  const handleTradeUpdated = useCallback(() => {
    mutateStats()
  }, [mutateStats])

  const reviewCount = stats?.review_counts
    ? (stats.review_counts.draft || 0) +
      (stats.review_counts.logged || 0) +
      (stats.review_counts.follow_up || 0) +
      (stats.review_counts.missing_screenshots || 0)
    : 0

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <h1 className={styles.heading}>Trade Journal</h1>
        <button
          className={`${styles.newTradeBtn} ${showNewForm ? styles.newTradeBtnActive : ''}`}
          onClick={handleNewTrade}
        >
          {showNewForm ? 'Cancel' : '+ New Trade'}
        </button>
      </div>

      {/* Tab bar */}
      <div className={styles.tabBar}>
        <div className={styles.tabScroll}>
          {JOURNAL_TABS.map(tab => (
            <button
              key={tab.key}
              className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
              onClick={() => handleTabChange(tab.key)}
            >
              {tab.label}
              {tab.key === 'queue' && reviewCount > 0 && (
                <span className={styles.tabBadge}>{reviewCount > 99 ? '99+' : reviewCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* New trade form (inline) */}
      {showNewForm && (
        <div className={styles.newFormWrap}>
          <TradeForm
            onSave={handleTradeCreated}
            onCancel={() => setShowNewForm(false)}
          />
        </div>
      )}

      {/* Tab content */}
      <div className={styles.content}>
        {activeTab === 'log' && (
          <TradeLog
            onOpenTrade={handleOpenTrade}
            stats={stats}
            onStatsChange={mutateStats}
            initialFilter={logFilter}
          />
        )}
        {activeTab === 'overview' && (
          <Overview
            onSwitchTab={handleSwitchTab}
            stats={stats}
            onOpenTrade={handleOpenTrade}
          />
        )}
        {activeTab === 'daily' && (
          <DailyNotes
            onOpenTrade={handleOpenTrade}
          />
        )}
        {activeTab === 'calendar' && (
          <CalendarReview
            onOpenTrade={handleOpenTrade}
          />
        )}
        {activeTab === 'analytics' && (
          <Analytics />
        )}
        {activeTab === 'playbooks' && (
          <Playbooks
            onOpenTrade={handleOpenTrade}
          />
        )}
        {activeTab === 'queue' && (
          <ReviewQueue
            onOpenTrade={handleOpenTrade}
          />
        )}
      </div>

      {/* Trade detail drawer */}
      {drawerTradeId && (
        <TradeDrawer
          tradeId={drawerTradeId}
          onClose={handleCloseDrawer}
          onTradeUpdated={handleTradeUpdated}
        />
      )}
    </div>
  )
}
