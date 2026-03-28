// app/src/pages/journal/tabs/ReviewQueue.jsx
import { useCallback } from 'react'
import useSWR from 'swr'
import styles from './ReviewQueue.module.css'

const fetcher = url => fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.json() })

const TYPE_CONFIG = {
  today_unreviewed: { label: 'TODAY', badgeClass: 'badgeToday', icon: '!' },
  follow_up:        { label: 'FOLLOW-UP', badgeClass: 'badgeFollowUp', icon: '\u21A9' },
  missing_process:  { label: 'NO PROCESS', badgeClass: 'badgeMissingProcess', icon: '\u25CE' },
  flagged:          { label: 'FLAGGED', badgeClass: 'badgeFlagged', icon: '\u2691' },
  missing_screenshots: { label: 'NO SCREENSHOTS', badgeClass: 'badgeMissingScreenshots', icon: '\u25A3' },
  missing_notes:    { label: 'NO NOTES', badgeClass: 'badgeMissingNotes', icon: '\u270E' },
  draft:            { label: 'DRAFT', badgeClass: 'badgeMissingNotes', icon: '\u25CB' },
  partial:          { label: 'PARTIAL', badgeClass: 'badgeMissingProcess', icon: '\u25D4' },
}

function getMissingText(item) {
  const missing = []
  if (!item.has_process_score) missing.push('process score')
  if (!item.has_notes) missing.push('notes')
  if (!item.has_screenshots) missing.push('screenshots')
  if (item.review_status === 'follow_up' && item.follow_up) {
    return item.follow_up
  }
  if (missing.length === 0) {
    if (item.type === 'today_unreviewed') return 'Not yet reviewed today'
    if (item.type === 'flagged') return 'Flagged for deeper review'
    return ''
  }
  return `Missing: ${missing.join(', ')}`
}

export default function ReviewQueue({ onOpenTrade }) {
  const { data: items, error, isLoading } = useSWR(
    '/api/journal/review-queue',
    fetcher,
    { refreshInterval: 60000, dedupingInterval: 15000, revalidateOnFocus: false }
  )

  const handleReview = useCallback((tradeId) => {
    if (onOpenTrade) onOpenTrade(tradeId)
  }, [onOpenTrade])

  if (isLoading && !items) {
    return (
      <div className={styles.wrap}>
        <div className={styles.loading}>
          <div className={styles.loadingBar} />
          <span>Loading review queue...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.wrap}>
        <div className={styles.error}>
          Failed to load review queue. Check your connection.
        </div>
      </div>
    )
  }

  if (!items || items.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>&#x2713;</div>
          <div className={styles.emptyTitle}>All caught up</div>
          <div className={styles.emptyText}>
            No items need review. Nice work keeping your journal current.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.queueHeader}>
        <span className={styles.queueTitle}>Review Queue</span>
        <span className={styles.queueCount}>{items.length} item{items.length !== 1 ? 's' : ''}</span>
      </div>

      <div className={styles.queueList}>
        {items.map(item => {
          const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.draft
          const missingText = getMissingText(item)

          return (
            <div key={item.id} className={styles.queueItem}>
              <span className={`${styles.typeBadge} ${styles[cfg.badgeClass] || ''}`}>
                {cfg.icon} {cfg.label}
              </span>
              <span className={styles.itemSym}>{item.sym || '--'}</span>
              <span className={styles.itemDate}>{item.entry_date || '--'}</span>
              {item.pnl_pct != null && (
                <span className={item.pnl_pct >= 0 ? styles.itemPnlGain : styles.itemPnlLoss}>
                  {item.pnl_pct > 0 ? '+' : ''}{Number(item.pnl_pct).toFixed(2)}%
                </span>
              )}
              {missingText && (
                <span className={styles.itemMissing}>{missingText}</span>
              )}
              <button
                className={styles.reviewBtn}
                onClick={() => handleReview(item.id)}
              >
                Review &#x2192;
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
