import { useState } from 'react'
import styles from './PatternAdmin.module.css'

function fmtPrice(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `$${Number(v).toFixed(2)}`
}

function fmtR(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${Number(v).toFixed(1)}R`
}

function fmtMinutes(detected_at) {
  if (!detected_at) return '—'
  const mins = Math.round(Date.now() / 1000 - detected_at) / 60
  if (mins < 1) return 'just now'
  if (mins < 60) return `${Math.round(mins)} min ago`
  const hrs = mins / 60
  if (hrs < 24) return `${hrs.toFixed(1)}h ago`
  const days = hrs / 24
  return `${days.toFixed(1)}d ago`
}

const RATING_LABELS = {
  great: 'Accepted',
  wrong: 'Rejected',
  miss: 'Flagged',
}

const RATING_COLORS = {
  great: '#10b981',
  wrong: '#ef4444',
  miss: '#f59e0b',
}

export default function DetectionReviewCard({ detection, onReview }) {
  const d = detection
  const [note, setNote] = useState(d.reviewer_note || '')
  const [submitting, setSubmitting] = useState(false)
  const [lastAction, setLastAction] = useState(null)

  const handleAction = async (action) => {
    setSubmitting(true)
    setLastAction(action)
    try {
      await onReview(action, note)
    } finally {
      setSubmitting(false)
    }
  }

  const dirColor =
    d.direction === 'bullish'
      ? '#10b981'
      : d.direction === 'bearish'
      ? '#ef4444'
      : '#c9a84c'

  const ratingColor = d.reviewer_rating ? RATING_COLORS[d.reviewer_rating] || '#a8a290' : null
  const ratingLabel = d.reviewer_rating ? RATING_LABELS[d.reviewer_rating] || d.reviewer_rating : null

  return (
    <div className={`${styles.card} ${d.reviewed ? styles.reviewed : ''}`}>
      <div className={styles.cardLeft}>
        <div className={styles.sym}>{d.sym}</div>
        <div className={styles.metaLine}>
          <span className={styles.tf}>{d.tf}</span>
          <span className={styles.conf}>conf {Math.round(d.confidence)}</span>
        </div>
        <div className={styles.pattern} style={{ color: dirColor }}>
          {d.pattern_name}
        </div>
        <div className={styles.category}>{d.category}</div>
      </div>

      <div className={styles.cardMiddle}>
        {d.narrative?.headline && (
          <div className={styles.headline}>{d.narrative.headline}</div>
        )}
        <div className={styles.levels}>
          <span className={styles.levelChip}>
            <label>E</label> {fmtPrice(d.levels?.entry)}
          </span>
          <span className={styles.levelChip}>
            <label>S</label> {fmtPrice(d.levels?.stop)}
          </span>
          <span className={styles.levelChip}>
            <label>T</label> {fmtPrice(d.levels?.target_primary)}
          </span>
          <span className={styles.levelChip}>
            <label>R:R</label> {fmtR(d.levels?.risk_reward)}
          </span>
        </div>
        <div className={styles.detected}>
          Detected {fmtMinutes(d.detected_at)} · status: <span className={styles.status}>{d.status}</span>
        </div>
        {d.reviewed && ratingLabel && (
          <div className={styles.reviewBadge} style={{ borderColor: ratingColor, color: ratingColor }}>
            {ratingLabel}
            {d.reviewer_note ? <span className={styles.reviewNote}> — "{d.reviewer_note}"</span> : null}
          </div>
        )}
      </div>

      <div className={styles.cardRight}>
        <textarea
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={styles.noteInput}
          rows={2}
        />
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => handleAction('accept')}
            disabled={submitting}
            className={`${styles.actionBtn} ${styles.accept}`}
            aria-label="Accept detection"
          >
            {submitting && lastAction === 'accept' ? '…' : 'Accept'}
          </button>
          <button
            type="button"
            onClick={() => handleAction('reject')}
            disabled={submitting}
            className={`${styles.actionBtn} ${styles.reject}`}
            aria-label="Reject detection"
          >
            {submitting && lastAction === 'reject' ? '…' : 'Reject'}
          </button>
          <button
            type="button"
            onClick={() => handleAction('flag')}
            disabled={submitting}
            className={`${styles.actionBtn} ${styles.flag}`}
            aria-label="Flag detection"
          >
            {submitting && lastAction === 'flag' ? '…' : 'Flag'}
          </button>
        </div>
      </div>
    </div>
  )
}
