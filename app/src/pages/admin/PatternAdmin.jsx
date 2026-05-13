import { useState, useMemo } from 'react'
import useSWR from 'swr'
import DetectionReviewCard from './DetectionReviewCard'
import styles from './PatternAdmin.module.css'

const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => r.json())

const HOURS_OPTIONS = [
  { value: 24, label: 'Last 24h' },
  { value: 48, label: 'Last 48h' },
  { value: 72, label: 'Last 72h' },
  { value: 168, label: 'Last 7 days' },
]

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'classical', label: 'Classical' },
  { value: 'candlestick', label: 'Candlestick' },
  { value: 'uct', label: 'UCT' },
  { value: 'structure', label: 'Structure' },
]

export default function PatternAdmin() {
  const [hours, setHours] = useState(24)
  const [reviewedFilter, setReviewedFilter] = useState('all') // 'all' | 'unreviewed' | 'reviewed'
  const [categoryFilter, setCategoryFilter] = useState('')

  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/patterns/recent?hours=${hours}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true }
  )

  const filtered = useMemo(() => {
    let dets = data?.detections || []
    if (reviewedFilter === 'unreviewed') dets = dets.filter((d) => !d.reviewed)
    else if (reviewedFilter === 'reviewed') dets = dets.filter((d) => d.reviewed)
    if (categoryFilter) dets = dets.filter((d) => d.category === categoryFilter)
    return dets
  }, [data, reviewedFilter, categoryFilter])

  const handleReview = async (detectionId, action, note) => {
    try {
      const r = await fetch(`/api/admin/patterns/${detectionId}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note || null }),
      })
      if (r.ok) {
        // Optimistic refresh — pulls the new review state
        mutate()
      } else {
        const err = await r.json().catch(() => ({}))
        console.error('Review failed:', err)
      }
    } catch (e) {
      console.error('Review network error:', e)
    }
  }

  const acceptRate = data?.accept_rate_pct
  const acceptRateColor =
    acceptRate == null
      ? '#a8a290'
      : acceptRate >= 85
      ? '#10b981'
      : acceptRate >= 70
      ? '#f59e0b'
      : '#ef4444'

  return (
    <div className={styles.page}>
      {/* Header bar */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.heading}>Pattern Verification</h1>
          <div className={styles.subheading}>Gate 5 — Shadow Mode Operator Review</div>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <label>Detections</label>
            <strong>{data?.count ?? '—'}</strong>
          </div>
          <div className={styles.stat}>
            <label>Reviewed</label>
            <strong>{data?.reviewed_count ?? '—'}</strong>
          </div>
          <div className={styles.stat}>
            <label>Accept Rate</label>
            <strong style={{ color: acceptRateColor }}>
              {acceptRate != null ? `${acceptRate.toFixed(1)}%` : '—'}
            </strong>
          </div>
          <div className={styles.stat}>
            <label>Target</label>
            <strong style={{ color: '#c9a84c' }}>&ge;85% / 5 days</strong>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className={styles.filters}>
        <label className={styles.filterLabel}>
          Window
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {HOURS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterLabel}>
          Show
          <select value={reviewedFilter} onChange={(e) => setReviewedFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="unreviewed">Unreviewed only</option>
            <option value="reviewed">Reviewed only</option>
          </select>
        </label>
        <label className={styles.filterLabel}>
          Category
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.filterMeta}>
          Showing {filtered.length} of {data?.count ?? 0}
        </div>
        <button
          className={styles.refreshBtn}
          onClick={() => mutate()}
          disabled={isLoading}
        >
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Feed */}
      {error && <div className={styles.error}>Failed to load: {String(error.message || error)}</div>}
      {isLoading && !data && <div className={styles.loading}>Loading detections…</div>}

      <div className={styles.feed}>
        {filtered.map((d) => (
          <DetectionReviewCard
            key={d.id}
            detection={d}
            onReview={(action, note) => handleReview(d.id, action, note)}
          />
        ))}
        {!isLoading && filtered.length === 0 && (
          <div className={styles.empty}>No detections match the current filters.</div>
        )}
      </div>
    </div>
  )
}
