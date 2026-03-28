// app/src/pages/journal/tabs/Overview.jsx
import { useState, useMemo, useCallback } from 'react'
import useSWR from 'swr'
import StatCard from '../components/StatCard'
import InsightCard from '../components/InsightCard'
import styles from './Overview.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const PERIOD_OPTIONS = [
  { key: '7', label: '1W' },
  { key: '30', label: '1M' },
  { key: '90', label: '3M' },
  { key: '180', label: '6M' },
  { key: '365', label: '1Y' },
  { key: '', label: 'All' },
]

function dateFrom(days) {
  if (!days) return ''
  const d = new Date()
  d.setDate(d.getDate() - parseInt(days))
  return d.toISOString().slice(0, 10)
}

function ReviewChip({ label, count, onClick }) {
  return (
    <button className={styles.chip} onClick={onClick}>
      <span>{label}</span>
      <span className={`${styles.chipCount} ${count === 0 ? styles.chipCountZero : ''}`}>
        {count > 99 ? '99+' : count}
      </span>
    </button>
  )
}

export default function Overview({ onSwitchTab, stats: parentStats, onOpenTrade }) {
  const [period, setPeriod] = useState('30')

  const from = dateFrom(period)
  const statsUrl = `/api/journal/stats${from ? `?date_from=${from}` : ''}`

  const { data: periodStats, error: statsError, isLoading: statsLoading } = useSWR(
    statsUrl,
    fetcher,
    { refreshInterval: 60000, dedupingInterval: 15000, revalidateOnFocus: false }
  )

  const { data: queue } = useSWR(
    '/api/journal/review-queue',
    fetcher,
    { refreshInterval: 120000, dedupingInterval: 30000, revalidateOnFocus: false }
  )

  const { data: insights } = useSWR(
    '/api/journal/insights',
    fetcher,
    { refreshInterval: 300000, dedupingInterval: 60000, revalidateOnFocus: false }
  )

  // Use period stats if available, fall back to parent stats
  const stats = periodStats || parentStats

  const handleSwitchToLog = useCallback((filterKey, filterVal) => {
    if (onSwitchTab) onSwitchTab('log', { [filterKey]: filterVal })
  }, [onSwitchTab])

  const handleSwitchToQueue = useCallback(() => {
    if (onSwitchTab) onSwitchTab('queue')
  }, [onSwitchTab])

  const queueCount = queue?.length || 0

  // Compute shortcut counts from stats review_counts
  const rc = stats?.review_counts || {}
  const todayTrades = stats?.today_trade_count || 0

  if (statsLoading && !stats) {
    return (
      <div className={styles.wrap}>
        <div className={styles.loading}>
          <div className={styles.loadingBar} />
          <span>Loading overview...</span>
        </div>
      </div>
    )
  }

  if (statsError) {
    return (
      <div className={styles.wrap}>
        <div className={styles.error}>
          Failed to load stats. Check your connection.
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>&#x229E;</div>
          <div className={styles.emptyTitle}>No data yet</div>
          <div className={styles.emptyText}>Log your first trade to see your overview dashboard.</div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      {/* Period selector */}
      <div className={styles.periodBar}>
        {PERIOD_OPTIONS.map(p => (
          <button
            key={p.key}
            className={`${styles.periodBtn} ${period === p.key ? styles.periodActive : ''}`}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* 6 KPI cards */}
      <div className={styles.kpiGrid}>
        <StatCard label="Net P&L" value={stats.total_pnl_pct} format="pct" accent="auto" />
        <StatCard label="Win Rate" value={stats.win_rate} format="pct" accent="neutral" />
        <StatCard label="Avg R" value={stats.avg_r} format="r" accent="auto" />
        <StatCard label="Profit Factor" value={stats.profit_factor} format="ratio" accent="neutral" />
        <StatCard label="Expectancy" value={stats.expectancy} format="pct" accent="auto" />
        <StatCard label="Process" value={stats.avg_process_score} format="score" accent="neutral" suffix="/100" />
      </div>

      {/* Review shortcuts */}
      <div className={styles.shortcutsSection}>
        <div className={styles.shortcutsLabel}>Review Shortcuts</div>
        <div className={styles.chipRow}>
          <ReviewChip
            label="Today's trades"
            count={todayTrades}
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10)
              handleSwitchToLog('date_from', today)
            }}
          />
          <ReviewChip
            label="Unreviewed"
            count={rc.logged || 0}
            onClick={() => handleSwitchToLog('review_status', 'logged')}
          />
          <ReviewChip
            label="Missing screenshots"
            count={rc.missing_screenshots || 0}
            onClick={() => handleSwitchToLog('has_screenshots', 'false')}
          />
          <ReviewChip
            label="Missing notes"
            count={rc.missing_notes || 0}
            onClick={() => handleSwitchToLog('has_notes', 'false')}
          />
          <ReviewChip
            label="Follow-up needed"
            count={rc.follow_up || 0}
            onClick={() => handleSwitchToLog('review_status', 'follow_up')}
          />
          <ReviewChip
            label="Flagged"
            count={rc.flagged || 0}
            onClick={() => handleSwitchToLog('review_status', 'flagged')}
          />
        </div>
      </div>

      {/* Queue banner */}
      {queueCount > 0 && (
        <div className={styles.queueBanner} onClick={handleSwitchToQueue}>
          <span className={styles.queueBannerCount}>{queueCount}</span>
          <span>item{queueCount !== 1 ? 's' : ''} need review</span>
          <span className={styles.queueBannerArrow}>&#x2192;</span>
        </div>
      )}

      {/* Insights section */}
      {insights && insights.length > 0 && (
        <div className={styles.insightsSection}>
          <div className={styles.insightsLabel}>Insights</div>
          <div className={styles.insightsList}>
            {insights.slice(0, 5).map(insight => (
              <InsightCard
                key={insight.id}
                insight={insight}
                onAction={(ins) => {
                  if (ins.action_type === 'filter' || ins.action_type === 'analytics') {
                    handleSwitchToLog('setup', '')
                  } else if (ins.action_type === 'playbooks') {
                    if (onSwitchTab) onSwitchTab('playbooks')
                  } else if (ins.action_type === 'review') {
                    if (onSwitchTab) onSwitchTab('queue')
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty insights state */}
      {insights && insights.length === 0 && stats?.total_trades != null && stats.total_trades < 10 && (
        <div className={styles.insightsEmpty}>
          <span className={styles.insightsEmptyText}>
            Log at least 10 trades to unlock personalized insights.
          </span>
        </div>
      )}
    </div>
  )
}
