/**
 * SourceRow — one connected note source (spec §8: "per-source rows
 * (freshness tone, counts, Sync now, pause, disconnect)").
 *
 * Disconnect uses the "arm, click again to confirm" idiom already used in
 * this codebase (TradeScreenshots.jsx's onDeleteClick) rather than
 * `window.confirm` — same 2-step shape, easier to test, no native dialog.
 * A `DELETE /{provider}` on this repo's contract is provider-scoped (spec
 * §8), so disconnecting any one source disconnects the whole provider; the
 * confirm copy says so when the provider has more than one source.
 */
import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { timeAgo } from '../../../../utils/timeAgo'
import styles from './ConnectedAppsCard.module.css'

function freshnessTone(source) {
  if (source.status === 'broken' || source.lastSyncStatus === 'error') return 'red'
  if (!source.syncEnabled) return 'amber'
  if (source.warmingUntil || source.lastSyncStatus === 'warning') return 'amber'
  if (source.lastSyncAt) return 'green'
  return 'amber'
}

function freshnessLabel(source) {
  if (source.status === 'broken') return 'reconnect needed'
  if (!source.syncEnabled) return 'sync paused'
  if (source.lastSyncAt) return `synced ${timeAgo(source.lastSyncAt)}`
  return 'not synced yet'
}

export default function SourceRow({ source, providerSourceCount = 1, onSync, onTogglePause, onDisconnect }) {
  const [syncing, setSyncing] = useState(false)
  const [pauseBusy, setPauseBusy] = useState(false)
  const [armed, setArmed] = useState(false)
  const armTimer = useRef(null)

  useEffect(() => () => clearTimeout(armTimer.current), [])

  const tone = freshnessTone(source)
  // `source.counts` is always a fully-shaped object — normalizeStatus
  // (useNoteConnectors.js) guarantees it, so no `|| {}` fallback here.
  const counts = source.counts
  const conflicts = counts.conflicts || 0

  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      await onSync(source)
    } catch {
      /* the row's own lastSyncError/status reflects the failure on refresh */
    } finally {
      setSyncing(false)
    }
  }

  const handleTogglePause = async () => {
    if (pauseBusy) return
    setPauseBusy(true)
    try {
      await onTogglePause(source)
    } finally {
      setPauseBusy(false)
    }
  }

  const handleDisconnectClick = () => {
    if (armed) {
      clearTimeout(armTimer.current)
      setArmed(false)
      onDisconnect(source)
    } else {
      setArmed(true)
      clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => setArmed(false), 4000)
    }
  }

  return (
    <div className={styles.sourceRow}>
      <div className={styles.sourceHead}>
        <span className={`${styles.dot} ${styles[`dot_${tone}`]}`} aria-hidden="true" />
        <span className={styles.sourceName}>{source.displayName || source.remoteId}</span>
        <span className={styles.sep}>·</span>
        <span className={styles.sourceSync}>{freshnessLabel(source)}</span>
      </div>

      <div className={styles.counts}>
        <Stat label="Created" value={counts.notesCreated} />
        <Stat label="Updated" value={counts.notesUpdated} />
        {conflicts > 0 && <Stat label="Conflicts" value={conflicts} warn />}
      </div>

      {source.lastSyncError && <p className={styles.sourceErr}>{source.lastSyncError}</p>}

      <div className={styles.sourceActions}>
        <button type="button" className={styles.ghostBtn} disabled={syncing} onClick={handleSync}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <label className={styles.toggle} title="Pause background sync">
          <input
            type="checkbox"
            checked={!!source.syncEnabled}
            disabled={pauseBusy}
            onChange={handleTogglePause}
          />
          <span>{source.syncEnabled ? 'On' : 'Paused'}</span>
        </label>
        <button
          type="button"
          className={`${styles.dangerBtn} ${armed ? styles.dangerArmed : ''}`}
          onClick={handleDisconnectClick}
          title={
            providerSourceCount > 1
              ? 'Disconnects every source for this provider'
              : 'Disconnect this source'
          }
        >
          <UIcon name="x" size={13} gold={false} />
          {armed ? 'Click again to disconnect' : 'Disconnect'}
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value, warn }) {
  return (
    <div className={styles.stat}>
      <span className={`${styles.statValue} ${warn ? styles.statWarn : ''}`}>{value ?? 0}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  )
}
