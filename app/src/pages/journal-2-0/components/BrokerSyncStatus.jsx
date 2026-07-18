/**
 * BrokerSyncStatus — a slim trust line: which broker is linked, how fresh the
 * data is, and a one-tap full re-sync. Builds confidence that the live numbers
 * are real + current. Self-hides for non-broker users. New component → only a
 * one-line mount touches shared UI.
 */
import { useState } from 'react'
import useSWR from 'swr'
import { timeAgoShort, formatET } from '../../../utils/timeAgo'
import styles from './BrokerSyncStatus.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}))

export default function BrokerSyncStatus({ onSynced }) {
  const { data, mutate } = useSWR('/api/j2/broker/status', fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const [busy, setBusy] = useState(false)

  const accounts = data?.accounts || []
  if (!data?.connected || accounts.length === 0) return null

  const broker = accounts[0]?.brokerageName || 'Brokerage'
  const latest = accounts
    .map((a) => a.lastSyncAt)
    .filter(Boolean)
    .sort()
    .pop()
  const broken = accounts.some((a) => a.status === 'broken')
  // Broker-reported holdings snapshot time (SnapTrade refreshes holdings
  // ~nightly; balances move intraday). Oldest across accounts — never
  // overclaim freshness.
  const holdingsAsOf = accounts
    .map((a) => a.holdingsSyncedAt)
    .filter(Boolean)
    .sort()
    .shift()

  const syncNow = async () => {
    setBusy(true)
    try {
      await fetch('/api/j2/broker/sync?full=1&force=1', {
        method: 'POST',
        credentials: 'include',
      })
      await mutate()
      onSynced?.()
    } catch {
      /* best-effort */
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.bar} role="status">
      <span className={`${styles.dot} ${broken ? styles.dotBroken : ''}`} aria-hidden="true" />
      <span className={styles.broker}>{broker}</span>
      <span className={styles.sep}>·</span>
      <span className={styles.muted}>
        {broken
          ? 'connection needs reconnect'
          : latest
            ? `synced ${timeAgoShort(latest)} ago`
            : 'not yet synced'}
      </span>
      <span className={styles.sep}>·</span>
      <span className={styles.muted} title="Fills appear within minutes during market hours (live order feed); full history reconciles automatically.">
        live fills
      </span>
      {!broken && holdingsAsOf && (
        <>
          <span className={styles.sep}>·</span>
          <span className={styles.muted} title="Your broker reports position holdings on a delayed schedule; balances update intraday.">
            positions as of {formatET(holdingsAsOf)} · balances live
          </span>
        </>
      )}
      <button type="button" className={styles.btn} onClick={syncNow} disabled={busy}>
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
    </div>
  )
}
