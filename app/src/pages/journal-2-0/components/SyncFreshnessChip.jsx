/**
 * SyncFreshnessChip — a small, reusable "Synced 12m ago · Sync now" pill.
 *
 * The trust surface's smallest unit: it tells you how fresh the broker data is
 * and lets you force a re-sync in one tap. Reads the SAME `/api/j2/broker/status`
 * data the Sync Trust Center + Open Positions bar already use (no new poller —
 * SWR dedups the shared key), and fires the SAME manual-sync call.
 *
 * Broker accounts ONLY: self-hides (renders null) when there is no broker
 * connection, so it is safe to mount on any surface (manual accounts see
 * nothing).
 *
 * No emoji — the refresh glyph is a branded <UIcon/>.
 */
import { useState } from 'react'
import useSWR from 'swr'
import UIcon from '../../../components/ui/UIcon'
import { timeAgo } from '../../../utils/timeAgo'
import styles from './SyncFreshnessChip.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : {}))

export default function SyncFreshnessChip({ onSynced }) {
  const { data, mutate } = useSWR('/api/j2/broker/status', fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const [busy, setBusy] = useState(false)

  const accounts = data?.accounts || []
  // Broker accounts only — nothing for manual/non-broker users.
  if (!data?.connected || accounts.length === 0) return null

  const broken = accounts.some((a) => a.status === 'broken')
  const latest = accounts
    .map((a) => a.lastSyncAt)
    .filter(Boolean)
    .sort()
    .pop()

  const label = broken
    ? 'Reconnect needed'
    : latest
      ? `Synced ${timeAgo(latest)}`
      : 'Not yet synced'

  const syncNow = async () => {
    if (busy) return
    setBusy(true)
    try {
      await fetch('/api/j2/broker/sync?full=1&force=1', {
        method: 'POST',
        credentials: 'include',
      })
      await mutate()
      onSynced?.()
    } catch {
      /* best-effort — the next poll reconciles */
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className={`${styles.chip} ${broken ? styles.chipBroken : ''}`} role="status">
      <span className={styles.icon} aria-hidden="true"><UIcon name="refresh" size={12} /></span>
      <span className={styles.label}>{label}</span>
      <span className={styles.sep} aria-hidden="true">·</span>
      <button type="button" className={styles.btn} onClick={syncNow} disabled={busy}>
        {busy ? 'Syncing…' : 'Sync now'}
      </button>
    </span>
  )
}
