import { useEffect, useState, useCallback } from 'react'
import { formatETDate, formatETFull } from '../../utils/timeAgo'
import styles from './VoiceInsightsPanel.module.css'

/**
 * Proactive insights inbox. Shows what the always-on watcher daemon
 * has surfaced — scanner matches, watchlist alerts, regime shifts,
 * drift warnings.
 *
 * Dismiss to suppress (so the assistant won't bring it up). Trigger an
 * on-demand scan with the "Scan now" button.
 */

const KIND_META = {
  scanner_match: { emoji: '🎯', label: 'Scanner match', color: '#4ade80' },
  watchlist_alert: { emoji: '⚑', label: 'Watchlist alert', color: '#fbbf24' },
  regime_shift: { emoji: '🌐', label: 'Regime shift', color: '#a78bfa' },
  drift_warning: { emoji: '⚠️', label: 'Drift warning', color: '#fca5a5' },
  mistake_pattern: { emoji: '🔁', label: 'Recurring mistake', color: '#fca5a5' },
}

function kindMeta(kind) {
  return KIND_META[kind] || { emoji: '🔔', label: kind, color: '#999' }
}

export default function VoiceInsightsPanel() {
  const [insights, setInsights] = useState([])
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')  // 'all' | 'pending' | 'dismissed'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/voice/insights', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setInsights(j.insights || [])
    } catch (e) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const dismiss = useCallback(async (id) => {
    try {
      await fetch(`/api/voice/insights/${id}/dismiss`, {
        method: 'POST', credentials: 'include',
      })
      await load()
    } catch (e) {
      setError(e?.message || 'Dismiss failed')
    }
  }, [load])

  const scanNow = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      const r = await fetch('/api/voice/insights/scan', {
        method: 'POST', credentials: 'include',
      })
      if (r.ok) {
        const j = await r.json()
        if (j.queued === 0) setError('Scan complete — nothing new to surface.')
      }
      await load()
    } catch (e) {
      setError(e?.message || 'Scan failed')
    } finally {
      setScanning(false)
    }
  }, [load])

  const filtered = insights.filter((i) => {
    if (filter === 'pending') return !i.delivered_at && !i.dismissed_at
    if (filter === 'dismissed') return !!i.dismissed_at
    return true
  })

  const pendingCount = insights.filter(
    (i) => !i.delivered_at && !i.dismissed_at
  ).length

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 className={styles.title}>
          Proactive insights
          {pendingCount > 0 && (
            <span className={styles.badge}>{pendingCount} new</span>
          )}
        </h3>
        <div className={styles.headerActions}>
          <button
            type="button"
            onClick={scanNow}
            className={styles.scanBtn}
            disabled={scanning}
          >
            {scanning ? 'Scanning…' : 'Scan now'}
          </button>
          <button
            type="button"
            onClick={load}
            className={styles.refresh}
            disabled={loading}
          >
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </div>
      <p className={styles.subtitle}>
        The watcher runs every 30 min during market hours. Insights are
        injected into your next voice session's system prompt; dismiss
        ones you don't want surfaced.
      </p>

      {error && <div className={styles.error}>{error}</div>}

      {/* Filter chips */}
      <div className={styles.filters}>
        {['all', 'pending', 'dismissed'].map((f) => (
          <button
            key={f}
            type="button"
            className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
            onClick={() => setFilter(f)}
          >
            {f}{f === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      {filtered.length === 0 && !loading && (
        <div className={styles.empty}>
          {filter === 'pending'
            ? 'No pending insights — watcher hasn\'t found anything new.'
            : 'No insights yet.'}
        </div>
      )}

      <div className={styles.list}>
        {filtered.map((i) => {
          const m = kindMeta(i.kind)
          const isPending = !i.delivered_at && !i.dismissed_at
          const isDismissed = !!i.dismissed_at
          return (
            <div
              key={i.id}
              className={`${styles.row} ${isDismissed ? styles.rowDismissed : ''}`}
              style={{ borderLeftColor: m.color }}
            >
              <div className={styles.rowEmoji} aria-hidden="true">{m.emoji}</div>
              <div className={styles.rowBody}>
                <div className={styles.rowTop}>
                  <span className={styles.rowKind} style={{ color: m.color }}>
                    {m.label}
                  </span>
                  {i.symbol && <span className={styles.rowSymbol}>{i.symbol}</span>}
                  <span className={styles.rowImportance}>
                    importance {i.importance}/10
                  </span>
                  <span className={styles.rowDate}>
                    {i.created_at ? formatETFull(i.created_at) : '—'}
                  </span>
                </div>
                <div className={styles.rowHeadline}>{i.headline}</div>
                {i.body && <div className={styles.rowText}>{i.body}</div>}
                <div className={styles.rowFooter}>
                  {isPending && <span className={styles.statusPending}>pending</span>}
                  {!isPending && !isDismissed && i.delivered_at && (
                    <span className={styles.statusDelivered}>
                      delivered {formatETDate(i.delivered_at)}
                    </span>
                  )}
                  {isDismissed && (
                    <span className={styles.statusDismissed}>dismissed</span>
                  )}
                </div>
              </div>
              <div className={styles.rowActions}>
                {!isDismissed && (
                  <button
                    type="button"
                    className={styles.dismissBtn}
                    onClick={() => dismiss(i.id)}
                    aria-label={`Dismiss insight ${i.headline}`}
                  >
                    Dismiss
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
