/**
 * BrokerReviewNudge — surfaces broker-imported trades/positions that still need
 * a setup tag, so auto-synced data turns into an actual journal. Self-hides when
 * nothing needs review (and for non-broker users). New component → no shared-UI
 * coupling beyond a one-line mount.
 */
import { useState } from 'react'
import useSWR from 'swr'
import styles from './BrokerReviewNudge.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { total: 0 }))

export default function BrokerReviewNudge({ onReview }) {
  const [dismissed, setDismissed] = useState(false)
  const { data } = useSWR('/api/j2/broker/unreviewed', fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const total = data?.total ?? 0
  if (dismissed || total === 0) return null

  return (
    <div className={styles.nudge} role="status">
      <span className={styles.icon} aria-hidden="true">📝</span>
      <span className={styles.text}>
        <strong>{total}</strong> broker-imported {total === 1 ? 'item needs' : 'items need'} a setup tag —
        add one to start journaling {total === 1 ? 'it' : 'them'}.
      </span>
      {onReview && (
        <button type="button" className={styles.btn} onClick={onReview}>
          Tag in Trade Journal
        </button>
      )}
      <button
        type="button"
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
